# Teacher and student data pipeline (design; nothing here runs paid models)

Status 2026-10-24. Builds on the trajectory recorder (branch reliability-trajectory: recorder,
redaction, exporter) and the fixture benchmark (scripts/bench/tasks-fixtures.js).

## Data rights come first

Provider terms decide which "teachers" may produce training data:
- Anthropic's commercial terms prohibit using the services to build competing products,
  including training competing AI models, without Anthropic's written approval; its support
  pages say training or developing AI models with the services needs written permission
  (https://www.anthropic.com/legal/commercial-terms).
- OpenAI's Services Agreement bars using Output to develop AI models that compete with OpenAI,
  with narrow exceptions (classifiers/embeddings not distributed; fine-tuning inside OpenAI's
  own services) (https://cdn.openai.com/osa/openai-services-agreement.pdf).
- These are read from search summaries; the operative text must be checked before any use.
A general browser-agent model is plausibly "competing", so commercial APIs are excluded as
teachers unless written permission is obtained. They remain usable as evaluators of Browsby
itself (not as training-data sources).

## Teacher sources, in order of preference

1. Self-generated, verified (rejection sampling / expert iteration): run Zigger 1.0 several
   times per fixture task (temperature varied with --sampling), keep only runs the deterministic
   checker passes with no premature claim and few repeats, train on those. Free, no rights issue,
   and it targets exactly the agent's own action distribution. Limitation: it cannot teach what
   the model never does; it sharpens what it sometimes does right.
2. Open-weight teacher with a permissive license, run locally: for example Qwen3.5-122B-A10B
   (Apache-2.0) at IQ3_XXS (44.7 GB) or Qwen3.8-27B (Apache-2.0, already on the server, 8/10 on
   the core benchmark, about 1.5 tok/s). Slow but free; suited to overnight batch generation on
   fixtures. Needs approval for any download and a server preset.
3. Human demonstrations and corrections: the reviewer fixes a failed student step in the review
   file the exporter writes; the corrected step becomes the label.
4. Commercial API teachers: only with written permission and an approved budget.

## Workflow

1. Tasks: fixture tasks (dev split only; the held-out split is never trained on), plus new
   fixture sites per failure category the benchmark exposes. Test accounts only, never real ones.
2. Generation: scripts/bench/run.js --taskfile tasks-fixtures.js --split dev --runs N
   --record <dir> [--sampling temperature=0.9] with the teacher model as --model.
3. Validation: the checker's verdict labels each trajectory (success / failure); premature
   completions, loop stops, and runs with permission prompts denied are excluded from training
   even when they passed.
4. Selection: keep successes; prefer the shortest successful trajectory per task (fewest model
   calls and repeats); cap examples per task so easy tasks do not dominate.
5. Comparison (student vs teacher): run the same task with student and teacher; for each step
   the student got wrong (tool error, repeat, wrong page), record the teacher's action on the
   student's own context: a "shadow teacher" call on the same #forModel() messages, recorded,
   not executed. This yields corrective examples in the student's own state distribution.
6. Export: scripts/export-trajectories.js -> OpenAI-style messages/tools JSONL matching the
   Qwen3.6 chat template (ChatML, XML tool calls, thinking off), plus a review file and a
   redaction report; nothing leaves the machine.

## What remains to build (all local, no paid calls)

- Shadow-teacher mode in Agent.run: a second provider.turn on the same messages for a second
  configured model, recorded with the step, never executed. Disabled unless a teacher is set.
- A selection script over recorded runs (rules in step 3-4).
- Fixture coverage: more sites per category, and a second, differently styled set of sites for
  an "unfamiliar website" split, so data and evaluation do not share page templates.
