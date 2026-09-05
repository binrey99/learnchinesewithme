export function openSentenceOrderPractice() {
  document.querySelector("#translation-level-screen").hidden = true;
  document.querySelector("#sentence-order-screen").hidden = false;
  document.querySelector("main").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
