// Settings offered only by internal builds (BROWSBY_INTERNAL=1 npm run build:extension);
// the store build never loads this module.

// The human-like mouse switch, under "Show the agent's actions". It saves itself here since it
// arrives after the shared [data-setting] wiring; later renders keep it in step with the config.
export function addHumanInputSetting(sheet, save, getConfig) {
  sheet.querySelector("#showActions").closest(".setting").insertAdjacentHTML(
    "afterend",
    `<div class="setting">
      <div class="setting-text">
        <label class="setting-title" for="humanInput">Human-like mouse</label>
        <p class="setting-desc" id="humanInput-desc">The mouse moves on curved paths at a person's pace, clicks somewhere inside each button and holds it briefly, and typing and scrolling take natural, varied pauses. Each click takes up to about a second longer. Internal builds only.</p>
      </div>
      <input id="humanInput" type="checkbox" role="switch" class="switch" data-setting="humanInput" aria-describedby="humanInput-desc" />
    </div>`,
  );
  const control = sheet.querySelector("#humanInput");
  control.checked = Boolean(getConfig()?.humanInput);
  control.addEventListener("change", () => save({ humanInput: control.checked }));
}
