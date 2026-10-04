"""LoRA fine-tuning of a Browsby base model with Unsloth, run on the training VM.

Each example in train.jsonl / eval.jsonl is one agent step: the conversation so far plus the
assistant turn to learn. The prompt part is rendered with the model's own chat template (with
the agent's tool definitions) and masked out, so loss covers only that last assistant turn.
The router of MoE models stays frozen and the vision tower is not touched (text-only LoRA).

Usage:
  python train.py --model Qwen/Qwen3.5-9B --loader dense --train train.jsonl --eval eval.jsonl \
      --out adapter [--load-4bit] [--rank 16] [--lr 1e-4] [--epochs 2] [--max-seq-len 16384] [--max-steps N]
"""

import argparse
import json
import math
import os
import time


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--loader", choices=["dense", "moe"], default="dense")
    p.add_argument("--train", required=True)
    p.add_argument("--eval")
    p.add_argument("--out", required=True)
    p.add_argument("--load-4bit", action="store_true")
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--epochs", type=float, default=2)
    p.add_argument("--max-seq-len", type=int, default=16384)
    p.add_argument("--max-steps", type=int, default=0, help="stop after this many steps when above 0")
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--grad-accum", type=int, default=8)
    p.add_argument("--deadline", type=float, default=0, help="unix time to stop training and save")
    return p.parse_args()


def read_jsonl(path):
    if not path or not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def render(tokenizer, messages, tools, add_generation_prompt):
    return tokenizer.apply_chat_template(
        messages, tools=tools, tokenize=False, add_generation_prompt=add_generation_prompt
    )


def encode(tokenizer, example, max_len):
    """Token ids and labels with everything before the last assistant turn masked."""
    messages, tools = example["messages"], example.get("tools")
    prompt = render(tokenizer, messages[:-1], tools, True)
    full = render(tokenizer, messages, tools, False)
    if not full.startswith(prompt):
        return None
    prompt_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
    full_ids = tokenizer(full, add_special_tokens=False)["input_ids"]
    if len(full_ids) > max_len or len(full_ids) <= len(prompt_ids):
        return None
    labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
    return {"input_ids": full_ids, "attention_mask": [1] * len(full_ids), "labels": labels}


def build_dataset(tokenizer, rows, max_len, name):
    from datasets import Dataset

    encoded, dropped = [], 0
    for row in rows:
        e = encode(tokenizer, row, max_len)
        if e is None:
            dropped += 1
        else:
            encoded.append(e)
    print(f"{name}: {len(encoded)} examples, {dropped} dropped (too long or template mismatch)", flush=True)
    return Dataset.from_list(encoded) if encoded else None


def main():
    args = parse_args()
    started = time.time()

    if args.loader == "moe":
        from unsloth import FastModel as Loader
    else:
        from unsloth import FastLanguageModel as Loader
    import torch
    from transformers import DataCollatorForSeq2Seq, Trainer, TrainerCallback, TrainingArguments

    model, tokenizer = Loader.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq_len,
        load_in_4bit=args.load_4bit,
        load_in_16bit=not args.load_4bit,
        full_finetuning=False,
    )
    text_tokenizer = getattr(tokenizer, "tokenizer", tokenizer)

    # Attention and MLP projections of the language model only; router and vision stay frozen.
    model = Loader.get_peft_model(
        model,
        r=args.rank,
        lora_alpha=args.rank,
        lora_dropout=0,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        max_seq_length=args.max_seq_len,
    )

    train_ds = build_dataset(text_tokenizer, read_jsonl(args.train), args.max_seq_len, "train")
    eval_ds = build_dataset(text_tokenizer, read_jsonl(args.eval), args.max_seq_len, "eval")
    if train_ds is None:
        raise SystemExit("no usable training examples")

    class Deadline(TrainerCallback):
        def on_step_end(self, _args, state, control, **_kw):
            if args.deadline and time.time() > args.deadline:
                print("deadline reached, stopping and saving", flush=True)
                control.should_training_stop = True
            return control

    steps_per_epoch = math.ceil(len(train_ds) / (args.batch * args.grad_accum))
    trainer = Trainer(
        model=model,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        data_collator=DataCollatorForSeq2Seq(text_tokenizer, padding=True, label_pad_token_id=-100),
        callbacks=[Deadline()],
        args=TrainingArguments(
            output_dir=os.path.join(args.out, "checkpoints"),
            per_device_train_batch_size=args.batch,
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            max_steps=args.max_steps if args.max_steps > 0 else -1,
            learning_rate=args.lr,
            lr_scheduler_type="cosine",
            warmup_steps=max(1, steps_per_epoch // 10),
            logging_steps=1,
            eval_strategy="epoch" if eval_ds is not None else "no",
            save_strategy="epoch",
            save_total_limit=1,
            optim="adamw_8bit",
            bf16=torch.cuda.is_bf16_supported(),
            fp16=not torch.cuda.is_bf16_supported(),
            seed=3407,
            report_to="none",
        ),
    )
    result = trainer.train()

    adapter_dir = os.path.join(args.out, "adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    metrics = {
        "model": args.model,
        "train_examples": len(train_ds),
        "eval_examples": len(eval_ds) if eval_ds is not None else 0,
        "train_loss": result.training_loss,
        "global_steps": result.global_step,
        "wall_seconds": round(time.time() - started),
        "log_history": trainer.state.log_history,
    }
    if eval_ds is not None:
        metrics["eval"] = trainer.evaluate()
    with open(os.path.join(args.out, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"saved adapter to {adapter_dir}", flush=True)


if __name__ == "__main__":
    main()
