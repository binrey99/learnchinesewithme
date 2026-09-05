import { openTranslationPractice } from "./translation.js";
import { openSentenceOrderPractice } from "./sentence-order.js";
import { openDictationPractice } from "./dictation.js";
import { openErrorCorrectionPractice } from "./error-correction.js";
import { openFillInTheBlankPractice } from "./fill-in-the-blank.js";
import { openQuestionAnswerPractice } from "./q-and-a.js";

export function setupPracticeMenu(showToast) {
  const handlers = {
    "Luyện dịch": openTranslationPractice,
    "Sắp xếp câu": openSentenceOrderPractice,
    "Chép chính tả": () => openDictationPractice(showToast),
    "Sửa câu sai": () => openErrorCorrectionPractice(showToast),
    "Điền từ": () => openFillInTheBlankPractice(showToast),
    "Hỏi đáp": () => openQuestionAnswerPractice(showToast),
  };

  document.querySelectorAll("[data-practice]").forEach((option) => {
    option.addEventListener("click", () => {
      document.querySelector("#practice-menu").classList.remove("open");
      document.querySelector("#practice-toggle").setAttribute("aria-expanded", "false");
      (handlers[option.dataset.practice] || (() => showToast(`Đã chọn mục luyện tập: ${option.dataset.practice}.`)))();
    });
  });
}
