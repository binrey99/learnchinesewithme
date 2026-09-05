import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

async function loadEnvironment() {
  const apiResponse = await fetch("./api/config", { cache: "no-store" });
  if (apiResponse.ok) {
    return apiResponse.json();
  }

  if (apiResponse.status !== 404) {
    throw new Error("Không thể tải cấu hình Supabase từ máy chủ.");
  }

  const localResponse = await fetch("./.env", { cache: "no-store" });
  if (!localResponse.ok) {
    throw new Error("Không thể tải file cấu hình .env.");
  }

  return Object.fromEntries(
    (await localResponse.text())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      }),
  );
}

const environment = await loadEnvironment();
const SUPABASE_URL = environment.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = environment.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Hãy điền SUPABASE_URL và SUPABASE_PUBLISHABLE_KEY trong file .env.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const toast = document.querySelector(".toast");
let toastTimer;
let currentUser = null;
const vocabularyProgressState = new Set();
const PINYIN_STORAGE_KEY = "learnchinesewithme-pinyin-enabled";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function normalizeTranslationAnswer(value) {
  return value
    .normalize("NFKC")
    .replace(/[\s，。！？、,.!?;:：；"'“”‘’（）()[\]{}…\-—_]/gu, "")
    .toLowerCase();
}

async function loadSentenceOrderProgress() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from("sentence_order_progress")
    .select("level,lesson,question_index,is_correct")
    .eq("user_id", currentUser.id);
  if (error) {
    showToast(`Không thể tải tiến độ sắp xếp câu: ${error.message}`);
    return;
  }
  sentenceOrderState.answered = new Set();
  sentenceOrderState.results = {};
  sentenceOrderState.completedLessons = new Set();
  data.forEach((row) => {
    const key = `${row.level}-${row.lesson}-${row.question_index}`;
    sentenceOrderState.answered.add(key);
    sentenceOrderState.results[key] = { isCorrect: row.is_correct };
  });
  for (const level of new Set(data.map((row) => row.level))) {
    for (let lesson = 1; lesson <= 10; lesson += 1) {
      const correctCount = data.filter((row) => row.level === level && row.lesson === lesson && row.is_correct).length;
      if (correctCount >= 10) sentenceOrderState.completedLessons.add(`${level}-${lesson}`);
    }
  }
  if (!document.querySelector("#sentence-order-screen").hidden && sentenceOrderState.level) {
    renderSentenceOrderSidebar(sentenceOrderState.level);
    renderSentenceOrderExercise();
  }
}

async function loadTranslationProgress() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from("translation_progress")
    .select("level,lesson,direction,question_index,is_correct")
    .eq("user_id", currentUser.id);
  if (error) {
    showToast(`Không thể tải tiến độ luyện dịch: ${error.message}`);
    return;
  }
  translationState.answered = new Set();
  translationState.results = {};
  data.forEach((row) => {
    const key = `${row.direction}-${row.lesson}-${row.question_index}`;
    translationState.answered.add(key);
    translationState.results[key] = { isCorrect: row.is_correct };
  });
  if (!document.querySelector("#translation-exercise").hidden && translationState.level) {
    startTranslation(translationState.level, translationState.lesson);
  } else if (translationState.level) {
    showTranslationLessons(translationState.level);
  }
}

async function saveSentenceOrderResult({ level, lesson, questionIndex, isCorrect }) {
  if (!currentUser) return;
  const { error } = await supabase.from("sentence_order_progress").upsert({
    user_id: currentUser.id,
    level,
    lesson,
    question_index: questionIndex,
    is_correct: isCorrect,
    answered_at: new Date().toISOString(),
  }, { onConflict: "user_id,level,lesson,question_index" });
  if (error) showToast(`Không thể lưu tiến độ: ${error.message}`);
}

async function saveTranslationResult({ level, lesson, direction, questionIndex, isCorrect }) {
  if (!currentUser) return;
  const { error } = await supabase.from("translation_progress").upsert({
    user_id: currentUser.id,
    level,
    lesson,
    direction,
    question_index: questionIndex,
    is_correct: isCorrect,
    answered_at: new Date().toISOString(),
  }, { onConflict: "user_id,level,lesson,direction,question_index" });
  if (error) showToast(`Không thể lưu tiến độ luyện dịch: ${error.message}`);
}

async function recordLearningProgress({ vocabularyDelta = 0, correctDelta = 0, incorrectDelta = 0 }) {
  if (!currentUser || (vocabularyDelta === 0 && correctDelta === 0 && incorrectDelta === 0)) return;
  const { error } = await supabase.rpc("update_learning_progress", {
    p_vocabulary_delta: vocabularyDelta,
    p_translation_correct_delta: correctDelta,
    p_translation_incorrect_delta: incorrectDelta,
  });
  if (error) showToast(`Không thể lưu tiến độ: ${error.message}`);
}

document.querySelectorAll(".main-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelector(".main-nav a.active")?.classList.remove("active");
    link.classList.add("active");
  });

  const notebookEditor = document.querySelector("#notebook-editor");
  const notebookStatus = document.querySelector("#notebook-status");
  notebookEditor.value = localStorage.getItem("learnchinesewithme-notebook") || "";
  notebookEditor.addEventListener("input", () => {
    localStorage.setItem("learnchinesewithme-notebook", notebookEditor.value);
    notebookStatus.textContent = "Đã lưu";
    clearTimeout(notebookEditor.saveTimer);
    notebookEditor.saveTimer = setTimeout(() => {
      notebookStatus.textContent = "Tự động lưu";
    }, 1200);
  });
});

const practiceToggle = document.querySelector("#practice-toggle");
const practiceMenu = document.querySelector("#practice-menu");
practiceToggle.addEventListener("click", () => {
  const isOpen = practiceMenu.classList.toggle("open");
  practiceToggle.setAttribute("aria-expanded", String(isOpen));
});

document.querySelectorAll("[data-practice]").forEach((option) => {
  option.addEventListener("click", () => {
    practiceMenu.classList.remove("open");
    practiceToggle.setAttribute("aria-expanded", "false");
    if (option.dataset.practice === "Luyện dịch") {
      document.querySelector("#sentence-order-screen").hidden = true;
      document.querySelector("#translation-level-screen").hidden = false;
      document.querySelector("main").hidden = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (option.dataset.practice === "Sắp xếp câu") {
      document.querySelector("#translation-level-screen").hidden = true;
      document.querySelector("#sentence-order-screen").hidden = false;
      document.querySelector("main").hidden = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    showToast(`Đã chọn mục luyện tập: ${option.dataset.practice}.`);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".practice-nav-item")) {
    practiceMenu.classList.remove("open");
    practiceToggle.setAttribute("aria-expanded", "false");
  }
});

document.querySelector("#translation-back").addEventListener("click", () => {
  document.querySelector("#translation-level-screen").hidden = true;
  document.querySelector("main").hidden = false;
  document.querySelector("#translation-level-screen .hsk-level-grid").hidden = false;
  document.querySelector("#translation-lesson-picker").hidden = true;
  document.querySelector("#translation-exercise").hidden = true;
});

document.querySelectorAll("[data-translation-level]").forEach((level) => {
  level.addEventListener("click", () => {
    showTranslationLessons(level.dataset.translationLevel);
  });
});

document.querySelector("#lesson-picker-back").addEventListener("click", () => {
  document.querySelector("#translation-lesson-picker").hidden = true;
  document.querySelector("#translation-level-screen .hsk-level-grid").hidden = false;
});

  function updateTranslationLevelCounts() {
    document.querySelectorAll("[data-translation-level]").forEach((levelCard) => {
      const level = levelCard.dataset.translationLevel;
      const count = translationState.exercises.filter((item) => item.level === level).length;
      const countLabel = levelCard.querySelector("b");
      if (countLabel) countLabel.textContent = `${count} câu`;
    });
  }

  async function loadTranslationExercises() {
    const select = "level,lesson,question_vi,answer_zh,explanation";
    const ranges = await Promise.all([
      supabase.from("translation_exercises").select(select).order("id", { ascending: true }).range(0, 999),
      supabase.from("translation_exercises").select(select).order("id", { ascending: true }).range(1000, 1999)
    ]);
    const failedPage = ranges.find(({ error }) => error);
    const data = ranges.flatMap(({ data: page }) => page || []);

    if (!failedPage && data.length) {
      translationState.exercises = data;
      updateTranslationLevelCounts();
      return;
    }

    const response = await fetch("./translation-exercises.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Không thể tải bài luyện dịch từ Supabase hoặc file dự phòng.");
    translationState.exercises = parseCsv(await response.text()).map((row) => ({
      level: row.level,
      lesson: Number(row.lesson),
      question_vi: row.question_vi,
      answer_zh: row.answer_zh,
      explanation: row.explanation
    }));
    updateTranslationLevelCounts();
  }

  function showTranslationLessons(level) {
    const levelExercises = translationState.exercises.filter((item) => item.level === level);
    const lessonCount = new Set(levelExercises.map((item) => item.lesson)).size;
    const lessonGrid = document.querySelector("#translation-lesson-grid");
    document.querySelector("#lesson-picker-level").textContent = level;
    lessonGrid.innerHTML = "";
    for (let lesson = 1; lesson <= lessonCount; lesson += 1) {
      const lessonExercises = levelExercises.filter((item) => item.lesson === lesson);
      const start = (lesson - 1) * 10 + 1;
      const end = start + lessonExercises.length - 1;
      const button = document.createElement("button");
      button.type = "button";
      const completed = isTranslationLessonCompleted(lessonExercises, lesson);
      button.className = `translation-lesson-card${completed ? " completed" : ""}`;
      button.dataset.translationLesson = String(lesson);
      button.innerHTML = `<strong>${completed ? "✓ " : ""}Bài ${lesson}</strong><span>Câu ${start}–${end}</span><small>${completed ? "Đã hoàn thành" : `${end - start + 1} câu`}</small>`;
      lessonGrid.appendChild(button);
    }
    renderTranslationSidebar(level, lessonCount);
    document.querySelector("#translation-level-screen .hsk-level-grid").hidden = true;
    document.querySelector("#translation-lesson-picker").hidden = false;
    document.querySelector("#translation-exercise").hidden = true;
  }

  function renderTranslationSidebar(level, lessonCount) {
    const sidebar = document.querySelector("#translation-sidebar-lessons");
    sidebar.innerHTML = "";
    for (let lesson = 1; lesson <= lessonCount; lesson += 1) {
      const start = (lesson - 1) * 10 + 1;
      const lessonExercises = translationState.exercises.filter((item) => item.level === level && item.lesson === lesson);
      const end = start + lessonExercises.length - 1;
      const button = document.createElement("button");
      button.type = "button";
      const completed = isTranslationLessonCompleted(lessonExercises, lesson);
      button.className = `sidebar-lesson${lesson === translationState.lesson ? " active" : ""}${completed ? " completed" : ""}`;
      button.dataset.sidebarLesson = String(lesson);
      button.innerHTML = `<strong>${completed ? "✓ " : ""}Bài ${lesson}</strong><span>Câu ${start}-${end}</span>${completed ? "<b>✓</b>" : lesson > 2 ? "<small>🔒</small>" : "<b>›</b>"}`;
      sidebar.appendChild(button);
    }

  }

  function isTranslationLessonCompleted(lessonExercises, lesson) {
    return lessonExercises.length > 0 && lessonExercises.every((_, index) =>
      translationState.results[`${translationState.direction}-${lesson}-${index}`]?.isCorrect,
    );
  }

  function updateDirectionUI() {
    const isVietnameseToChinese = translationState.direction === "vi-zh";
    document.querySelector("#direction-vi-zh").classList.toggle("active", isVietnameseToChinese);
    document.querySelector("#direction-zh-vi").classList.toggle("active", !isVietnameseToChinese);
    const direction = isVietnameseToChinese ? "Việt → Trung" : "Trung → Việt";
    document.querySelector("#translation-direction-label").textContent = direction;
    document.querySelector("#progress-direction").textContent = direction;
    document.querySelector("#translation-answer-label").textContent = `✎ Dịch sang tiếng ${isVietnameseToChinese ? "Trung" : "Việt"}`;
    document.querySelector("#translation-answer").placeholder = `Nhập bản dịch tiếng ${isVietnameseToChinese ? "Trung" : "Việt"}...`;
  }

  function sentencePinyin(sentence = "") {
    const phraseMap = {
      我通常学习中文: "Wǒ tōngcháng xuéxí Zhōngwén",
      我通常喝水: "Wǒ tōngcháng hē shuǐ",
      我通常吃饭: "Wǒ tōngcháng chī fàn",
      我通常看电视: "Wǒ tōngcháng kàn diànshì",
      我通常听音乐: "Wǒ tōngcháng tīng yīnyuè",
      我通常看书: "Wǒ tōngcháng kàn shū",
      我通常上学: "Wǒ tōngcháng shàngxué",
      我通常回家: "Wǒ tōngcháng huí jiā",
      我通常买东西: "Wǒ tōngcháng mǎi dōngxi",
      我通常睡觉: "Wǒ tōngcháng shuìjiào",
    };
    const normalized = sentence.replace(/[。！？、，,.!?]/g, "");
    if (phraseMap[normalized]) return phraseMap[normalized];
    const syllables = [...normalized].map((character) => pinyinMap[character]).filter(Boolean);
    return syllables.length === [...normalized].length ? syllables.join(" ") : "";
  }

  function renderChinesePrompt(chinese) {
    const pinyin = translationState.pinyinEnabled ? sentencePinyin(chinese) : "";
    return pinyin ? `<small class="prompt-pinyin">${pinyin}</small><span>${chinese}</span>` : `<span>${chinese}</span>`;
  }

  function renderQuestionNumbers(total) {
    const container = document.querySelector("#question-numbers");
    container.innerHTML = "";
    for (let index = 0; index < total; index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = index + 1;
      const result = translationState.results[`${translationState.direction}-${translationState.lesson}-${index}`];
      button.className = `${index === translationState.index ? "active " : ""}${result?.isCorrect ? "answered" : ""}`;
      button.dataset.questionIndex = String(index);
      container.appendChild(button);
    }
  }

  function startTranslation(level, lesson) {
    translationState.level = level;
    translationState.lesson = lesson;
    translationState.index = 0;
    const lessonExercises = translationState.exercises.filter((item) => item.level === level && item.lesson === lesson);
    translationState.answered = new Set(
      lessonExercises
        .map((_, index) => `${translationState.direction}-${lesson}-${index}`)
        .filter((key) => translationState.results[key]),
    );
    translationState.correct = lessonExercises.filter((_, index) => translationState.results[`${translationState.direction}-${lesson}-${index}`]?.isCorrect).length;
    translationState.incorrect = lessonExercises.filter((_, index) => translationState.results[`${translationState.direction}-${lesson}-${index}`] && !translationState.results[`${translationState.direction}-${lesson}-${index}`].isCorrect).length;
    updateTranslationScore();
    document.querySelector("#translation-level-screen .hsk-level-grid").hidden = true;
    document.querySelector("#translation-lesson-picker").hidden = true;
    document.querySelector("#translation-exercise").hidden = false;
    renderTranslationExercise();
  }

  function updateTranslationScore() {
    document.querySelector("#translation-correct-count").textContent = translationState.correct;
    document.querySelector("#translation-incorrect-count").textContent = translationState.incorrect;
  }

  function renderTranslationExercise() {
    const exercises = translationState.exercises.filter((item) => item.level === translationState.level && item.lesson === translationState.lesson);
    const exercise = exercises[translationState.index];
    if (!exercise) {
      showToast("Chưa có dữ liệu cho cấp độ này.");
      return;
    }
    document.querySelector("#exercise-level-label").textContent = `${translationState.level} · Bài ${translationState.lesson}`;
    document.querySelector("#breadcrumb-level").textContent = translationState.level;
    document.querySelector("#breadcrumb-lesson").textContent = `Bài ${translationState.lesson}`;
    document.querySelector("#translation-total-label").textContent = `${exercises.length} câu luyện dịch`;
    document.querySelector("#progress-current").textContent = translationState.index + 1;
    document.querySelector("#progress-total").textContent = exercises.length;
    document.querySelector("#translation-progress-bar").style.width = `${((translationState.index + 1) / exercises.length) * 100}%`;
    document.querySelector("#translation-prompt").innerHTML = translationState.direction === "vi-zh"
      ? `<strong>${exercise.question_vi}</strong>`
      : renderChinesePrompt(exercise.answer_zh);
    renderQuestionNumbers(exercises.length);
    updateDirectionUI();
    document.querySelector("#translation-answer").value = "";
    document.querySelector("#exercise-feedback").hidden = true;
    document.querySelector("#next-translation").hidden = true;
    document.querySelector("#check-translation").hidden = false;
    const result = translationState.results[`${translationState.direction}-${translationState.lesson}-${translationState.index}`];
    if (result?.isCorrect) document.querySelector("#check-translation").hidden = true;
  }

  document.querySelector("#check-translation").addEventListener("click", () => {
    const exercises = translationState.exercises.filter((item) => item.level === translationState.level && item.lesson === translationState.lesson);
    const exercise = exercises[translationState.index];
    const answer = normalizeTranslationAnswer(document.querySelector("#translation-answer").value);
    const expected = translationState.direction === "vi-zh" ? exercise.answer_zh : exercise.question_vi;
    const correct = normalizeTranslationAnswer(expected);
    const isCorrect = answer === correct;
    const feedback = document.querySelector("#exercise-feedback");
    const answerKey = `${translationState.direction}-${translationState.lesson}-${translationState.index}`;
    if (!translationState.answered.has(answerKey)) {
      translationState.answered.add(answerKey);
      if (isCorrect) {
        translationState.correct += 1;
      } else {
        translationState.incorrect += 1;
      }
      translationState.results[answerKey] = { isCorrect };
      renderQuestionNumbers(exercises.length);
      saveTranslationResult({
        level: translationState.level,
        lesson: translationState.lesson,
        direction: translationState.direction,
        questionIndex: translationState.index,
        isCorrect,
      });
      recordLearningProgress({
        correctDelta: isCorrect ? 1 : 0,
        incorrectDelta: isCorrect ? 0 : 1,
      });
    }
    updateTranslationScore();
    feedback.hidden = false;
    feedback.className = `exercise-feedback ${isCorrect ? "correct" : "incorrect"}`;
    const referencePinyin = translationState.direction === "vi-zh" && translationState.pinyinEnabled
      ? `<small class="feedback-pinyin">${sentencePinyin(exercise.answer_zh)}</small>`
      : "";
    feedback.innerHTML = isCorrect
      ? "Chính xác! 🎉<small>Bạn đã trả lời đúng câu này.</small>"
      : `Đáp án tham khảo: <strong>${expected}</strong>${referencePinyin}<small>${exercise.explanation}</small>`;
    document.querySelector("#check-translation").hidden = true;
    document.querySelector("#next-translation").hidden = false;
  });

  document.querySelector("#next-translation").addEventListener("click", () => {
    const total = translationState.exercises.filter((item) => item.level === translationState.level && item.lesson === translationState.lesson).length;
    translationState.index = (translationState.index + 1) % total;
    renderTranslationExercise();
  });

  document.querySelector("#previous-translation").addEventListener("click", () => {
    const total = translationState.exercises.filter((item) => item.level === translationState.level && item.lesson === translationState.lesson).length;
    translationState.index = (translationState.index - 1 + total) % total;
    renderTranslationExercise();
  });

  document.querySelector("#question-numbers").addEventListener("click", (event) => {
    const question = event.target.closest("[data-question-index]");
    if (!question) return;
    translationState.index = Number(question.dataset.questionIndex);
    renderTranslationExercise();
  });

  document.querySelector("#direction-vi-zh").addEventListener("click", () => {
    translationState.direction = "vi-zh";
    renderTranslationExercise();
  });

  document.querySelector("#direction-zh-vi").addEventListener("click", () => {
    translationState.direction = "zh-vi";
    renderTranslationExercise();
  });

  const pinyinToggle = document.querySelector("#pinyin-toggle");
  pinyinToggle.checked = localStorage.getItem(PINYIN_STORAGE_KEY) === "true";
  pinyinToggle.addEventListener("change", () => {
    translationState.pinyinEnabled = pinyinToggle.checked;
    localStorage.setItem(PINYIN_STORAGE_KEY, String(pinyinToggle.checked));
    if (!document.querySelector("#translation-exercise").hidden) renderTranslationExercise();
  });

  document.querySelector("#translation-sidebar-lessons").addEventListener("click", (event) => {
    const lessonButton = event.target.closest("[data-sidebar-lesson]");
    if (!lessonButton) return;
    startTranslation(translationState.level, Number(lessonButton.dataset.sidebarLesson));
  });

  document.querySelector("#exercise-back").addEventListener("click", () => {
    document.querySelector("#translation-exercise").hidden = true;
    document.querySelector("#translation-lesson-picker").hidden = false;
  });

  document.querySelector("#translation-lesson-grid").addEventListener("click", (event) => {
    const lessonCard = event.target.closest("[data-translation-lesson]");
    if (!lessonCard) return;
    startTranslation(
      document.querySelector("#lesson-picker-level").textContent,
      Number(lessonCard.dataset.translationLesson)
    );
  });

  function parseSentenceWords(value) {
    if (Array.isArray(value)) return value.map(String);
    const text = String(value || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // CSV exports may contain a simple pipe-delimited list.
    }
    return text.split("|").map((word) => word.trim()).filter(Boolean);
  }

  async function loadSentenceOrderExercises() {
    const select = "level,lesson,question_vi,answer_zh,words,explanation";
    const { data, error } = await supabase
      .from("sentence_order_exercises")
      .select(select)
      .order("id", { ascending: true })
      .range(0, 999);
    if (!error && data?.length) {
      sentenceOrderState.exercises = data.map((row) => ({ ...row, lesson: Number(row.lesson), words: parseSentenceWords(row.words) }));
      updateSentenceOrderLevelCounts();
      return;
    }
    const response = await fetch("./sentence-order-exercises.csv?v=2", { cache: "no-store" });
    if (!response.ok) throw new Error("Không thể tải bài sắp xếp câu từ Supabase hoặc file dự phòng.");
    sentenceOrderState.exercises = parseCsv(await response.text()).map((row) => ({
      level: row.level,
      lesson: Number(row.lesson),
      question_vi: row.question_vi,
      answer_zh: row.answer_zh,
      words: parseSentenceWords(row.words),
      explanation: row.explanation,
    }));
    updateSentenceOrderLevelCounts();
  }

  function updateSentenceOrderLevelCounts() {
    document.querySelectorAll("[data-sentence-level]").forEach((card) => {
      const count = sentenceOrderState.exercises.filter((item) => item.level === card.dataset.sentenceLevel).length;
      const countLabel = card.querySelector("b");
      if (countLabel) countLabel.textContent = `${count} câu`;
    });
  }

  function sentenceOrderExercisesForCurrentLesson() {
    return sentenceOrderState.exercises.filter(
      (item) => item.level === sentenceOrderState.level && item.lesson === sentenceOrderState.lesson,
    );
  }

  function showSentenceOrderLessons(level) {
    const levelExercises = sentenceOrderState.exercises.filter((item) => item.level === level);
    const lessonGrid = document.querySelector("#sentence-order-lesson-grid");
    document.querySelector("#sentence-lesson-picker-level").textContent = level;
    lessonGrid.innerHTML = "";
    for (let lesson = 1; lesson <= 10; lesson += 1) {
      const lessonExercises = levelExercises.filter((item) => item.lesson === lesson);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "translation-lesson-card";
      button.dataset.sentenceLesson = String(lesson);
      const completed = sentenceOrderState.completedLessons.has(`${level}-${lesson}`);
      button.classList.toggle("completed", completed);
      button.innerHTML = `<strong>${completed ? "✓ " : ""}Bài ${lesson}</strong><span>Câu ${(lesson - 1) * 10 + 1}–${lesson * 10}</span><small>${completed ? "Đã hoàn thành" : `${lessonExercises.length} câu`}</small>`;
      button.disabled = !lessonExercises.length;
      lessonGrid.appendChild(button);
    }
    renderSentenceOrderSidebar(level);
    document.querySelector("#sentence-order-screen .hsk-level-grid").hidden = true;
    document.querySelector("#sentence-order-lesson-picker").hidden = false;
    document.querySelector("#sentence-order-exercise").hidden = true;
  }

  function renderSentenceOrderSidebar(level) {
    const sidebar = document.querySelector("#sentence-sidebar-lessons");
    sidebar.innerHTML = "";
    for (let lesson = 1; lesson <= 10; lesson += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sidebar-lesson${lesson === sentenceOrderState.lesson ? " active" : ""}`;
      button.dataset.sentenceSidebarLesson = String(lesson);
      const completed = sentenceOrderState.completedLessons.has(`${level}-${lesson}`);
      button.classList.toggle("completed", completed);
      button.innerHTML = `<strong>${completed ? "✓ " : ""}Bài ${lesson}</strong><span>Câu ${(lesson - 1) * 10 + 1}-${lesson * 10}</span><b>${completed ? "✓" : "›"}</b>`;
      button.disabled = !sentenceOrderState.exercises.some((item) => item.level === level && item.lesson === lesson);
      sidebar.appendChild(button);
    }
  }

  function normalizeSentenceOrder(value) {
    return String(value || "").normalize("NFKC").replace(/[\s。！？、，,.!?;:：；"'“”‘’（）()[\]{}…\-—_]/gu, "");
  }

  function renderSentenceOrderNumbers(total) {
    const container = document.querySelector("#sentence-question-numbers");
    container.innerHTML = "";
    for (let index = 0; index < total; index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = index + 1;
      const key = `${sentenceOrderState.level}-${sentenceOrderState.lesson}-${index}`;
      const result = sentenceOrderState.results[key];
      button.className = `${index === sentenceOrderState.index ? "active " : ""}${result?.isCorrect ? "answered" : ""}`;
      button.dataset.sentenceQuestionIndex = String(index);
      container.appendChild(button);
    }
  }

  function shuffledSentenceWords(words) {
    const result = words.map((word, index) => ({ word, index }));
    if (result.length > 1) {
      const shift = result.length > 2 ? 1 : 0;
      result.push(...result.splice(0, shift));
      if (result.every((item, index) => item.index === index)) result.reverse();
    }
    return result;
  }

  function renderSentenceOrderChips(exercise) {
    const container = document.querySelector("#sentence-order-chips");
    const key = `${sentenceOrderState.level}-${sentenceOrderState.lesson}-${sentenceOrderState.index}`;
    if (!sentenceOrderState.orders[key]) sentenceOrderState.orders[key] = shuffledSentenceWords(exercise.words);
    container.innerHTML = "";
    sentenceOrderState.orders[key].forEach((item, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sentence-word-chip";
      chip.draggable = true;
      chip.dataset.chipIndex = String(index);
      chip.textContent = item.word;
      chip.addEventListener("click", () => {
        if (sentenceOrderState.justDragged) {
          sentenceOrderState.justDragged = false;
          return;
        }
        const current = sentenceOrderState.orders[key];
        const [selected] = current.splice(index, 1);
        current.push(selected);
        renderSentenceOrderChips(exercise);
      });
      chip.addEventListener("dragstart", (event) => {
        sentenceOrderState.dragIndex = index;
        event.dataTransfer.effectAllowed = "move";
        chip.classList.add("dragging");
      });
      chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
      chip.addEventListener("dragover", (event) => event.preventDefault());
      chip.addEventListener("drop", (event) => {
        event.preventDefault();
        reorderSentenceChip(key, sentenceOrderState.dragIndex, index);
      });
      chip.addEventListener("pointerdown", () => {
        sentenceOrderState.pointerIndex = index;
        sentenceOrderState.pointerStart = Date.now();
      });
      chip.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse" || sentenceOrderState.pointerIndex === null) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".sentence-word-chip");
        if (!target || target === chip) return;
        const targetIndex = Number(target.dataset.chipIndex);
        reorderSentenceChip(key, sentenceOrderState.pointerIndex, targetIndex);
        sentenceOrderState.pointerIndex = targetIndex;
        sentenceOrderState.justDragged = true;
      });
      chip.addEventListener("pointerup", () => {
        sentenceOrderState.pointerIndex = null;
      });
      container.appendChild(chip);
    });
  }

  function reorderSentenceChip(key, fromIndex, toIndex) {
    if (fromIndex === null || fromIndex === toIndex || fromIndex < 0) return;
    const order = sentenceOrderState.orders[key];
    const [item] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, item);
    const exercise = sentenceOrderExercisesForCurrentLesson()[sentenceOrderState.index];
    if (exercise) renderSentenceOrderChips(exercise);
  }

  function updateSentenceOrderScore() {
    document.querySelector("#sentence-correct-count").textContent = sentenceOrderState.correct;
    document.querySelector("#sentence-incorrect-count").textContent = sentenceOrderState.incorrect;
  }

  function renderSentenceOrderExercise() {
    const exercises = sentenceOrderExercisesForCurrentLesson();
    const exercise = exercises[sentenceOrderState.index];
    if (!exercise) return;
    document.querySelector("#sentence-exercise-level-label").textContent = `${sentenceOrderState.level} · Bài ${sentenceOrderState.lesson}`;
    document.querySelector("#sentence-breadcrumb-level").textContent = sentenceOrderState.level;
    document.querySelector("#sentence-breadcrumb-lesson").textContent = `Bài ${sentenceOrderState.lesson}`;
    document.querySelector("#sentence-total-label").textContent = `${exercises.length} câu sắp xếp`;
    document.querySelector("#sentence-progress-current").textContent = sentenceOrderState.index + 1;
    document.querySelector("#sentence-progress-total").textContent = exercises.length;
    document.querySelector("#sentence-progress-bar").style.width = `${((sentenceOrderState.index + 1) / exercises.length) * 100}%`;
    document.querySelector("#sentence-order-prompt").textContent = exercise.question_vi;
    renderSentenceOrderNumbers(exercises.length);
    renderSentenceOrderChips(exercise);
    const answered = sentenceOrderState.answered.has(`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${sentenceOrderState.index}`);
    const feedback = document.querySelector("#sentence-order-feedback");
    const result = sentenceOrderState.results[`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${sentenceOrderState.index}`];
    feedback.hidden = !answered;
    document.querySelector("#check-sentence-order").hidden = Boolean(answered && result?.isCorrect);
    if (result) {
      feedback.className = `exercise-feedback ${result.isCorrect ? "correct" : "incorrect"}`;
      feedback.innerHTML = result.isCorrect
        ? "Chính xác! 🎉<small>Bạn đã sắp xếp đúng câu này.</small>"
        : `Đáp án tham khảo: <strong>${exercise.answer_zh}</strong><small>${exercise.explanation || "Hãy chú ý trật tự từ trong câu."}</small>`;
    } else {
      feedback.className = "exercise-feedback";
      feedback.innerHTML = "";
    }
  }

  function startSentenceOrder(level, lesson) {
    sentenceOrderState.level = level;
    sentenceOrderState.lesson = lesson;
    sentenceOrderState.index = 0;
    const lessonKey = (index) => `${level}-${lesson}-${index}`;
    const lessonExercises = sentenceOrderState.exercises.filter((item) => item.level === level && item.lesson === lesson);
    sentenceOrderState.correct = lessonExercises.filter((_, index) => sentenceOrderState.results[lessonKey(index)]?.isCorrect).length;
    sentenceOrderState.incorrect = lessonExercises.filter((_, index) => sentenceOrderState.results[lessonKey(index)] && !sentenceOrderState.results[lessonKey(index)].isCorrect).length;
    sentenceOrderState.orders = {};
    updateSentenceOrderScore();
    document.querySelector("#sentence-order-screen .hsk-level-grid").hidden = true;
    document.querySelector("#sentence-order-lesson-picker").hidden = true;
    document.querySelector("#sentence-order-exercise").hidden = false;
    renderSentenceOrderSidebar(level);
    renderSentenceOrderExercise();
  }

  document.querySelectorAll("[data-sentence-level]").forEach((level) => {
    level.addEventListener("click", () => showSentenceOrderLessons(level.dataset.sentenceLevel));
  });
  document.querySelector("#sentence-order-back").addEventListener("click", () => {
    document.querySelector("#sentence-order-screen").hidden = true;
    document.querySelector("main").hidden = false;
    document.querySelector("#sentence-order-screen .hsk-level-grid").hidden = false;
    document.querySelector("#sentence-order-lesson-picker").hidden = true;
    document.querySelector("#sentence-order-exercise").hidden = true;
  });
  document.querySelector("#sentence-lesson-picker-back").addEventListener("click", () => {
    document.querySelector("#sentence-order-lesson-picker").hidden = true;
    document.querySelector("#sentence-order-screen .hsk-level-grid").hidden = false;
  });
  document.querySelector("#sentence-order-lesson-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-sentence-lesson]");
    if (card && !card.disabled) startSentenceOrder(document.querySelector("#sentence-lesson-picker-level").textContent, Number(card.dataset.sentenceLesson));
  });
  document.querySelector("#sentence-exercise-back").addEventListener("click", () => {
    document.querySelector("#sentence-order-exercise").hidden = true;
    document.querySelector("#sentence-order-lesson-picker").hidden = false;
  });
  document.querySelector("#sentence-sidebar-lessons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sentence-sidebar-lesson]");
    if (button && !button.disabled) startSentenceOrder(sentenceOrderState.level, Number(button.dataset.sentenceSidebarLesson));
  });
  document.querySelector("#sentence-question-numbers").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sentence-question-index]");
    if (!button) return;
    sentenceOrderState.index = Number(button.dataset.sentenceQuestionIndex);
    renderSentenceOrderExercise();
  });
  document.querySelector("#check-sentence-order").addEventListener("click", () => {
    const exercise = sentenceOrderExercisesForCurrentLesson()[sentenceOrderState.index];
    const key = `${sentenceOrderState.level}-${sentenceOrderState.lesson}-${sentenceOrderState.index}`;
    const order = sentenceOrderState.orders[key] || [];
    const answer = order.map((item) => item.word).join("");
    const isCorrect = normalizeSentenceOrder(answer) === normalizeSentenceOrder(exercise.answer_zh);
    if (!sentenceOrderState.answered.has(key)) {
      sentenceOrderState.answered.add(key);
    }
    sentenceOrderState.results[key] = { isCorrect };
    const currentLessonExercises = sentenceOrderExercisesForCurrentLesson();
    sentenceOrderState.correct = currentLessonExercises.filter((_, index) => sentenceOrderState.results[`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${index}`]?.isCorrect).length;
    sentenceOrderState.incorrect = currentLessonExercises.filter((_, index) => sentenceOrderState.results[`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${index}`] && !sentenceOrderState.results[`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${index}`].isCorrect).length;
    renderSentenceOrderNumbers(currentLessonExercises.length);
    if (isCorrect) {
      const correctCount = currentLessonExercises.filter((_, index) => sentenceOrderState.results[`${sentenceOrderState.level}-${sentenceOrderState.lesson}-${index}`]?.isCorrect).length;
      if (correctCount >= currentLessonExercises.length) {
        sentenceOrderState.completedLessons.add(`${sentenceOrderState.level}-${sentenceOrderState.lesson}`);
        renderSentenceOrderSidebar(sentenceOrderState.level);
        showSentenceOrderLessons(sentenceOrderState.level);
        document.querySelector("#sentence-order-exercise").hidden = false;
        document.querySelector("#sentence-order-lesson-picker").hidden = true;
      }
    }
    saveSentenceOrderResult({
      level: sentenceOrderState.level,
      lesson: sentenceOrderState.lesson,
      questionIndex: sentenceOrderState.index,
      isCorrect,
    });
    updateSentenceOrderScore();
    const feedback = document.querySelector("#sentence-order-feedback");
    feedback.hidden = false;
    feedback.className = `exercise-feedback ${isCorrect ? "correct" : "incorrect"}`;
    feedback.innerHTML = isCorrect ? "Chính xác! 🎉<small>Bạn đã sắp xếp đúng câu này.</small>" : `Đáp án tham khảo: <strong>${exercise.answer_zh}</strong><small>${exercise.explanation || "Hãy chú ý trật tự từ trong câu."}</small>`;
    document.querySelector("#check-sentence-order").hidden = true;
  });
  document.querySelector("#next-sentence-order").addEventListener("click", () => {
    const total = sentenceOrderExercisesForCurrentLesson().length;
    sentenceOrderState.index = (sentenceOrderState.index + 1) % total;
    renderSentenceOrderExercise();
  });
  document.querySelector("#previous-sentence-order").addEventListener("click", () => {
    const total = sentenceOrderExercisesForCurrentLesson().length;
    sentenceOrderState.index = (sentenceOrderState.index - 1 + total) % total;
    renderSentenceOrderExercise();
  });

loadTranslationExercises()
  .then(() => {
    if (currentUser) loadTranslationProgress();
  })
  .catch((error) => showToast(error.message));

document.querySelectorAll(".level-tabs button").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelector(".level-tabs button.active")?.classList.remove("active");
    tab.classList.add("active");
    const level = tab.dataset.level;
    document.querySelectorAll(".lesson-row").forEach((lesson) => {
      lesson.classList.toggle("hidden-level", lesson.dataset.level !== level);
    });
  });
});

document.querySelectorAll("[data-lesson]").forEach((button) => {
  button.addEventListener("click", () => showToast(`Đã chọn ${button.dataset.lesson}. Chúc bạn học vui!`));
});

document.querySelector("#next-word").addEventListener("click", () => {
  showToast("Từ tiếp theo sẽ xuất hiện trong phiên ôn tập của bạn.");
});

document.querySelector("#streak-button").addEventListener("click", () => {
  showToast("Tuyệt vời! Bạn đã duy trì chuỗi học 7 ngày 🔥");
});

document.querySelector("#search-toggle").addEventListener("click", () => {
  showToast("Tìm kiếm bài học, từ vựng hoặc chủ đề bạn muốn học.");
});

const loginModal = document.querySelector("#login-modal");
const loginOpen = document.querySelector("#login-open");
const loginClose = document.querySelector("#login-close");
let authMode = "login";

function setLoginOpen(isOpen) {
  loginModal.hidden = !isOpen;
  document.body.classList.toggle("modal-open", isOpen);
  if (isOpen) document.querySelector("#email").focus();
}

loginOpen.addEventListener("click", () => setLoginOpen(true));
loginClose.addEventListener("click", () => setLoginOpen(false));
loginModal.addEventListener("click", (event) => {
  if (event.target === loginModal) setLoginOpen(false);
});

document.querySelector("#password-toggle").addEventListener("click", (event) => {
  const password = document.querySelector("#password");
  const isPassword = password.type === "password";
  password.type = isPassword ? "text" : "password";
  event.currentTarget.textContent = isPassword ? "Ẩn" : "Hiện";
});

document.querySelector("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (authMode === "signup") {
    signUpWithEmail(event.currentTarget);
  } else {
    signInWithPassword(event.currentTarget);
  }
});

document.querySelector("#google-login").addEventListener("click", () => {
  signInWithGoogle();
});

document.querySelector("#signup-link").addEventListener("click", () => setAuthMode("signup"));

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  document.querySelector("#auth-eyebrow").textContent = isSignup ? "TẠO TÀI KHOẢN MỚI" : "CHÀO MỪNG BẠN TRỞ LẠI";
  document.querySelector("#login-title").textContent = isSignup ? "Bắt đầu hành trình học" : "Đăng nhập để tiếp tục học";
  document.querySelector(".login-subtitle").textContent = isSignup ? "Tạo tài khoản miễn phí để lưu tiến độ học tập." : "Theo dõi tiến độ và duy trì chuỗi học của bạn.";
  document.querySelector("#confirm-password-row").hidden = !isSignup;
  document.querySelector("#confirm-password").required = isSignup;
  document.querySelector(".login-submit").innerHTML = isSignup ? "Tạo tài khoản <span>→</span>" : "Đăng nhập <span>→</span>";
  document.querySelector("#auth-switch").innerHTML = isSignup
    ? 'Đã có tài khoản? <button type="button" id="signup-link">Đăng nhập</button>'
    : 'Chưa có tài khoản? <button type="button" id="signup-link">Đăng ký miễn phí</button>';
  document.querySelector("#signup-link").addEventListener("click", () => setAuthMode(isSignup ? "login" : "signup"));
}

async function signInWithPassword(form) {
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Đang đăng nhập...";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  submitButton.disabled = false;
  submitButton.innerHTML = "Đăng nhập <span>→</span>";

  if (error) {
    showToast(`Đăng nhập thất bại: ${error.message}`);
    return;
  }
  setLoginOpen(false);
  showToast("Đăng nhập thành công. Chào mừng bạn trở lại!");
}

async function signUpWithEmail(form) {
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const confirmPassword = form.elements.confirmPassword.value;
  if (!email || password.length < 6) {
    showToast("Hãy nhập email và mật khẩu tối thiểu 6 ký tự trước.");
    return;
  }
  if (password !== confirmPassword) {
    showToast("Mật khẩu nhập lại chưa khớp.");
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });
  if (error) {
    showToast(`Đăng ký thất bại: ${error.message}`);
    return;
  }
  setLoginOpen(false);
  showToast("Đăng ký thành công. Kiểm tra email để xác nhận tài khoản.");
}

async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getAuthRedirectUrl() },
  });
  if (error) showToast(`Không thể đăng nhập Google: ${error.message}`);
}

function getAuthRedirectUrl() {
  return window.location.href.split("#")[0];
}

supabase.auth.onAuthStateChange((event, session) => {
  currentUser = session?.user || null;
  if (session?.user) {
    loadSentenceOrderProgress();
    loadTranslationProgress();
    const userName = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "bạn";
    document.querySelector(".hero h1 span:first-of-type").textContent = `${userName}!`;
    document.querySelector(".avatar").textContent = userName.slice(0, 2).toUpperCase();
    if (event === "SIGNED_IN") {
      setLoginOpen(false);
      showToast("Xác nhận email thành công. Bạn đã đăng nhập!");
    }
  }
});

const vocabularyState = { words: [], level: "Tất cả", query: "", visible: 12 };
const translationState = { exercises: [], level: "", lesson: 1, index: 0, direction: "vi-zh", pinyinEnabled: localStorage.getItem(PINYIN_STORAGE_KEY) === "true", answered: new Set(), results: {}, correct: 0, incorrect: 0 };
const sentenceOrderState = { exercises: [], level: "", lesson: 1, index: 0, answered: new Set(), results: {}, completedLessons: new Set(), orders: {}, correct: 0, incorrect: 0, dragIndex: null, pointerIndex: null, pointerStart: 0, justDragged: false };

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || "").trim()])));
}

loadSentenceOrderExercises().catch((error) => showToast(error.message));

function normalizeHsk(value) {
  const match = value.replace(/\s+/g, "").match(/^HSK(\d+)$/i);
  return match ? `HSK ${match[1]}` : "";
}

function renderVocabulary() {
  const filtered = vocabularyState.words.filter((word) => {
    const levelMatch = vocabularyState.level === "Tất cả" || word.level === vocabularyState.level;
    const query = vocabularyState.query.toLowerCase();
    return levelMatch && (!query || `${word.vocab} ${word.vietnamese} ${word.pinyin}`.toLowerCase().includes(query));
  });
  const visibleWords = filtered.slice(0, vocabularyState.visible);
  document.querySelector("#vocabulary-count").textContent = `${filtered.length} từ`;
  document.querySelector("#vocabulary-grid").innerHTML = visibleWords.length
    ? visibleWords.map((word, index) => `<button class="vocabulary-item" type="button" data-vocabulary-index="${vocabularyState.words.indexOf(word)}"><div class="vocabulary-word">${word.vocab}</div><div class="vocabulary-pinyin">${word.pinyin || "—"}</div><strong>${word.vietnamese || word.english || "Chưa có nghĩa"}</strong><span>${word.level} · ${word.type || "Từ vựng"}</span></button>`).join("")
    : '<p class="empty-vocabulary">Không tìm thấy từ vựng phù hợp.</p>';
  document.querySelector("#load-more-vocabulary").hidden = visibleWords.length >= filtered.length;
  document.querySelectorAll("[data-vocabulary-index]").forEach((card) => card.addEventListener("click", () => {
    openVocabularyDetail(vocabularyState.words[Number(card.dataset.vocabularyIndex)]);
  }));
}

function openVocabularyDetail(word) {
  document.querySelector("#vocabulary-detail-level").textContent = word.level;
  document.querySelector("#vocabulary-detail-title").textContent = word.vocab;
  document.querySelector("#vocabulary-detail-pinyin").textContent = word.pinyin || "Chưa có pinyin";
  document.querySelector("#vocabulary-detail-meaning").textContent = word.vietnamese || word.english || "Chưa có nghĩa";
  document.querySelector("#vocabulary-detail-meta").textContent = `${word.type || "Từ vựng"} · ${word.english || "Chưa có nghĩa tiếng Anh"}`;
  document.querySelector("#vocabulary-detail-component").textContent = word.component || "Chưa có dữ liệu component.";
  document.querySelector("#vocabulary-detail-component-pinyin").textContent = componentPinyin(word.component);
  document.querySelector("#vocabulary-detail-component-vi").textContent = translateComponent(word.component);
  document.querySelector("#vocabulary-modal").hidden = false;
  const vocabularyKey = word.id || `${word.level}:${word.vocab}`;
  if (!vocabularyProgressState.has(vocabularyKey)) {
    vocabularyProgressState.add(vocabularyKey);
    recordLearningProgress({ vocabularyDelta: 1 });
  }
}

const pinyinMap = {
  您好: "nín hǎo", 您: "nín", 你好: "nǐ hǎo", 你: "nǐ", 好: "hǎo",
  早上: "zǎo shang", 早: "zǎo", 今天: "jīn tiān", 今: "jīn", 天: "tiān",
  怎么样: "zěn me yàng", 怎: "zěn", 么: "me", 样: "yàng", 谢谢: "xiè xie",
  叫: "jiào", 什么: "shén me", 什: "shén", 名字: "míng zi", 名: "míng",
  字: "zì", 露西: "Lù xī", 汤姆: "Tāng mǔ", 能: "néng", 可以: "kě yǐ",
  以: "yǐ", 我: "wǒ", 人: "rén", 为: "wéi", 很: "hěn", 了: "le",
  没有: "méi yǒu", 没: "méi", 有: "yǒu", 说: "shuō", 话: "huà",
  学习: "xué xí", 中文: "Zhōng wén", 中国: "Zhōng guó", 家: "jiā",
  爸爸: "bà ba", 妈妈: "mā ma", 哥哥: "gē ge", 姐姐: "jiě jie",
  女: "nǚ", 子: "zǐ", 心: "xīn", 小: "xiǎo", 手: "shǒu", 戈: "gē",
  日: "rì", 十: "shí", 上: "shàng", 一: "yī", 大: "dà", 水: "shuǐ",
  氵: "shuǐ", 木: "mù", 羊: "yáng", 口: "kǒu", 讠: "yán", 尔: "ěr",
  亻: "rén", 射: "shè", 雨: "yǔ", 足: "zú", 夂: "zhǐ", 西: "xī",
  母: "mǔ", 月: "yuè", 厶: "sī", 力: "lì", 点: "diǎn", 正: "zhèng",
  马: "mǎ", 丽: "lì", 北: "běi", 京: "jīng", 门: "mén", 开: "kāi",
};

function componentPinyin(component = "") {
  if (!component) return "Chưa có dữ liệu pinyin.";
  return component.replace(/[\u3400-\u9fff]+/g, (hanzi) => {
    if (pinyinMap[hanzi]) return `${hanzi} (${pinyinMap[hanzi]})`;
    const characters = [...hanzi];
    const syllables = characters.map((character) => pinyinMap[character]).filter(Boolean);
    return syllables.length === characters.length
      ? `${hanzi} (${syllables.join(" ")})`
      : `${hanzi} (chưa có pinyin)`;
  });
}

const componentTranslations = {
  human: "người",
  person: "người",
  you: "bạn",
  that: "đó",
  good: "tốt",
  female: "nữ",
  woman: "phụ nữ",
  child: "trẻ em",
  heart: "trái tim",
  small: "nhỏ",
  knife: "con dao",
  hand: "bàn tay",
  spear: "ngọn giáo",
  sun: "mặt trời",
  ten: "số mười",
  line: "nét thẳng",
  big: "lớn",
  private: "riêng tư",
  water: "nước",
  speech: "lời nói",
  shoot: "bắn",
  mouth: "miệng",
  power: "sức mạnh",
  force: "lực",
  evening: "buổi tối",
  roof: "mái nhà",
  west: "phía tây",
  horse: "ngựa",
  rain: "mưa",
  foot: "bàn chân",
  go: "đi",
  morning: "buổi sáng",
  moon: "mặt trăng",
  sudden: "đột ngột",
  start: "bắt đầu",
  wood: "gỗ",
  sheep: "con dê",
  stopping: "dừng lại",
  step: "bước chân",
  that: "đó",
  slash: "nét phẩy",
  dot: "dấu chấm",
  mile: "dặm",
  correct: "đúng",
  down: "xuống",
  unknown: "chưa rõ",
};

function translateComponent(component = "") {
  if (!component) return "Chưa có dữ liệu giải thích tiếng Việt.";
  return component.replace(/\b[A-Za-z][A-Za-z /-]*\b/g, (term) => {
    const words = term.trim().toLowerCase().split(/\s*\/\s*|\s+/);
    const translations = words.map((word) => componentTranslations[word]).filter(Boolean);
    return translations.length ? `${term} — ${translations.join(" / ")}` : term;
  });
}

function setupVocabulary(words) {
  const normalized = words.map((row) => {
    const vocab = row.Vocab;
    return {
      level: normalizeHsk(row.Book_Level),
      vocab,
      vietnamese: row.Vietnamese_Meaning,
      english: row.English_Meaning,
      type: row.Word_Type,
      pinyin: row.Pinyin || row.Pinyin_Meaning || getWordPinyin(vocab),
      component: row.Component,
    };
  }).filter((word) => word.level && word.vocab);
  vocabularyState.words = normalized;
  const levels = [...new Set(normalized.map((word) => word.level))].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  document.querySelector("#hsk-filters").innerHTML = ["Tất cả", ...levels].map((level, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-vocabulary-level="${level}">${level}</button>`).join("");
  document.querySelectorAll("[data-vocabulary-level]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector("[data-vocabulary-level].active")?.classList.remove("active");
    button.classList.add("active");
    vocabularyState.level = button.dataset.vocabularyLevel;
    vocabularyState.visible = 12;
    renderVocabulary();
  }));
  renderVocabulary();
}

function getWordPinyin(word = "") {
  if (pinyinMap[word]) return pinyinMap[word];
  const syllables = [...word].map((character) => pinyinMap[character]).filter(Boolean);
  return syllables.length === [...word].length ? syllables.join(" ") : "";
}

async function loadVocabulary() {
  const vocabularyQuery = () => supabase
    .from("vocabulary")
    .select("app_level,book_level,quest_name,quiz_id,quiz_name,vocab,english_meaning,vietnamese_meaning,word_type,photo,component,level_method")
    .order("id", { ascending: true });
  const [firstPage, secondPage] = await Promise.all([
    vocabularyQuery().range(0, 999),
    vocabularyQuery().range(1000, 1999),
  ]);
  const error = firstPage.error || secondPage.error;
  const data = [...(firstPage.data || []), ...(secondPage.data || [])];

  if (!error && data?.length) {
    setupVocabulary(data.map((row) => ({
      App_level: row.app_level,
      Book_Level: row.book_level,
      Quest_Name: row.quest_name,
      Quiz_ID: row.quiz_id,
      Quiz_Name: row.quiz_name,
      Vocab: row.vocab,
      English_Meaning: row.english_meaning,
      Vietnamese_Meaning: row.vietnamese_meaning,
      Word_Type: row.word_type,
      Photo: row.photo,
      Component: row.component,
      Level_Method: row.level_method,
    })));
    return;
  }

  const response = await fetch("./vocabulary.csv?v=3", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(error?.message || `Không thể tải vocabulary.csv (${response.status})`);
  }
  setupVocabulary(parseCsv(await response.text()));
}

loadVocabulary().catch((error) => {
  document.querySelector("#vocabulary-count").textContent = "Chưa tải được dữ liệu";
  document.querySelector("#vocabulary-grid").innerHTML = `<p class="empty-vocabulary">${error.message}</p>`;
});

document.querySelector("#vocabulary-search").addEventListener("input", (event) => {
  vocabularyState.query = event.target.value;
  vocabularyState.visible = 12;
  renderVocabulary();
});

document.querySelector("#load-more-vocabulary").addEventListener("click", () => {
  vocabularyState.visible += 12;
  renderVocabulary();
});

document.querySelector("#vocabulary-close").addEventListener("click", () => {
  document.querySelector("#vocabulary-modal").hidden = true;
});

document.querySelector("#vocabulary-modal").addEventListener("click", (event) => {
  if (event.target.id === "vocabulary-modal") event.currentTarget.hidden = true;
});
