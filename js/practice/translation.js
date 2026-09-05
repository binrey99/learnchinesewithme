export function openTranslationPractice() {
  document.querySelector("#sentence-order-screen").hidden = true;
  document.querySelector("#translation-level-screen").hidden = false;
  document.querySelector("#translation-level-screen .hsk-level-grid").hidden = false;
  document.querySelector("#translation-lesson-picker").hidden = true;
  document.querySelector("#translation-exercise").hidden = true;
  document.querySelector("main").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
