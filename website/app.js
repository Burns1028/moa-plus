"use strict";

// This is an illustrative conversation, not a live agent or model connection.
const translations = {
  zh: {
    skip: "跳到正文",
    navigation: "主导航",
    navWhy: "协作理念",
    navHow: "如何协作",
    navStart: "开始使用",
    heroEyebrow: "Mixture of Agents · 为 DSH 而生",
    heroLine1: "一个目标。",
    heroLine2: "多个头脑。",
    heroLine3: "新的可能。",
    heroDescription:
      "MoA+ 是 DeepSeek Harness 的多 Agent 协作插件。独立的 Agent 一起探索、构建和审阅，并把共享知识带入下一次任务。",
    tryRuntime: "体验运行时",
    viewSource: "探索源代码",
    heroRelease: "开源。基于 DSH 原生运行时。",
    stageTag: "一支团队，在对话中协作",
    illustration: "协作示意",
    coordinatorRole: "保持全局判断",
    branchLabel: "独立的执行上下文",
    sharedKnowledge: "共享知识",
    networkDescription:
      "Coordinator 连接三个持续可用的专业 Worker。Worker 可以直接交流，并把发现写入共享上下文索引。",
    demoSteps: "协作示意步骤",
    step1: "分工",
    step2: "交流",
    step3: "审阅",
    step4: "延续",
    replay: "重新播放协作示意",
    heroBottom: "独立思考。共同前进。",
    scroll: "看看团队背后的思路",
    whyEyebrow: "为什么需要协作",
    whyHeading1: "更多 Agent 是数量。",
    whyHeading2: "更好的协作才是目标。",
    whyLede:
      "长程任务不断消耗上下文、判断力与注意力。MoA+ 为它们留出各自的空间。",
    principle1Title: "始终看得见目标。",
    principle1Body:
      "Worker 承接工具输出、试验和反复尝试。Coordinator 保持对全局的判断：目标是什么，做了什么决定，下一步该往哪里走。",
    principle1Foot: "局部上下文 · 全局判断",
    principle2Title: "给不同意见留个位置。",
    principle2Body:
      "干净的上下文，带来不同的出发点。Fork 一条有希望的路径，比较多种方案，再让独立审阅者检查实际产物。",
    principle2Foot: "独立视角 · 共同目标",
    principle3Title: "让进展成为下一次的起点。",
    principle3Body:
      "并行推进，直接交流，把团队学到的东西留下来。持续可用的 Worker 与索引式知识，让下一个任务能够接着往前走。",
    principle3Foot: "并行工作 · 持久知识",
    toolkitEyebrow: "简洁的工具，开放的协作方式",
    toolkitHeading: "五个原语。\n让团队找到\n自己的协作方式。",
    toolkitLede:
      "Coordinator 与 Worker 使用同一套原生 Agent Loop。身份、工具与继承的权限，决定各自的职责。",
    readToolContract: "阅读工具契约",
    toolTask: "以干净的上下文和明确的责任，启动一位专业 Worker。",
    toolFork: "从 Agent 已提交的历史分支，探索另一个方向。",
    toolMessage: "与同伴直接交流。即时引导、排队指令，或请求明确回复。",
    toolQuery: "查看状态和指定的对话历史，或等待协作有新进展。",
    toolKill: "停止并等待执行退出。保留对话，或显式销毁它。",
    memoryEyebrow: "一支有记忆的团队",
    memoryHeading1: "工作会结束。",
    memoryHeading2: "学到的会留下。",
    memoryLede:
      "Worker 在两次任务之间持续可用，完整的最终回复回到指定接收者。经过确认的发现，成为下一次任务可以取用的知识。",
    exploreArchitecture: "探索协作架构",
    workspace: "工作区 /",
    builtToContinue: "为下一次延续",
    fileNotes:
      "目标、分工、进度与阻塞。Coordinator 每次推理前，完整刷新当前记录。",
    fileArchive: "已告一段落的工作及结果。让眼前清晰，也保留来路。",
    fileRubrics: "独立编写的验收标准，以最初的需求为依据。",
    fileContext: "共享发现、决策与方法的索引。先读地图，再加载真正需要的内容。",
    memoryFooter: "进度留在记录里，知识留在 Context 中。",
    reviewEyebrow: "独立的完成审阅",
    reviewHeading: "另一双眼睛，\n检查真实的证据。",
    reviewBody:
      "独立的 Builder 从原始需求和规格中制定验收标准。Verifier 使用原生工具检查实际产物。缺少证据或结果不完整，工作就进入下一轮。",
    reviewLink: "查看验证记录",
    watchEyebrow: "真实工作，有迹可循",
    watchHeading: "看一场对话，\n如何成为一次交付。",
    watchBody:
      "一次真实的协作流程：派发专业 Worker，在子会话中直接调整方向，审阅结果，再让同一支团队带着已有上下文继续下一个任务。",
    reproduce: "复现这次协作",
    watchVideo: "在 GitHub 观看历史 v0.1.23 工作流录像",
    filmLabel: "来自历史记录",
    filmTitle: "一支团队。一个任务。下一步。",
    filmDisclosure:
      "早期 Project Mode 预览 · 60 秒剪辑，已标注等待。历史录像，并非当前运行时。",
    startEyebrow: "和团队一起构建",
    startHeading1: "从一个值得思考的",
    startHeading2: "难题开始。",
    startLede: "带上你的模型、工作区，还有那个想弄明白的问题。",
    getOnGithub: "在 GitHub 获取 MoA+",
    sourceInstallation: "从源码安装",
    installTitle: "从 main 体验新运行时。",
    installRequirements: "需要 Node 24.9+、npm 和 Git。",
    installCompatibility:
      "从 main 安装时，需要匹配的 DSH 0.2.1-rc.3 兼容运行时：涉及 19 个原生包、43 个文件路径。",
    installIsolation:
      "启动器准备独立的 Web 环境，使用单独的 home、配置与文档目录，不会安装进你的个人 Desktop 应用。",
    firstRunGuide: "首次运行与回滚指南",
    installationCommands: "安装命令",
    copy: "复制命令",
    installAfter: "在原生设置中配置模型，并在新会话的第一条消息前选中 MoA+。",
    lookingForRelease: "在找已发布的版本？",
    olderVersion: "v0.1.23 是较早的 Project Mode 预览。",
    olderInstructions: "请使用该版本的安装说明 ↗",
    footerTagline: "让智慧，在协作中生长。",
    backTop: "回到顶部",
    footerDisclosure: "非官方 DeepSeek Harness 插件。以 MIT 协议开源。",
    footerDocs: "文档 ↗",
    footerIssues: "反馈 ↗",
    composerHint: "新会话的第一条消息前选择",
  },
  en: {},
};

const demos = {
  en: [
    {
      tool: "Task / Fork",
      title: "Give each mind room.",
      from: "Coordinator → team",
      avatar: "C",
      message:
        "“Explore the constraints. Build an approach. Review it independently.”",
      detail:
        "Start a specialist fresh with Task, or use Fork to carry useful history into a different line of work.",
      statuses: ["Finding the edges", "Building a path", "A fresh perspective"],
    },
    {
      tool: "SendMessage · Request / reply_to",
      title: "Let the team talk.",
      from: "Maker ↔ Explorer",
      avatar: "M",
      message:
        "“Should the export preserve the original order?” → “Yes. Preserve the source order.”",
      detail:
        "A peer can ask a blocking question. An explicit reply_to answers the request, so the work can continue with the decision.",
      statuses: ["Answering a peer", "Decision received", "Preparing review"],
    },
    {
      tool: "Independent Builder + Verifier",
      title: "Challenge the result.",
      from: "Verifier → Coordinator",
      avatar: "V",
      message:
        "“The criteria come from the original request. I’m checking the artifact and its evidence.”",
      detail:
        "A separate Builder authors the rubric; the Verifier examines the actual result. Missing evidence leads to another pass.",
      statuses: ["Findings available", "Artifact ready", "Checking evidence"],
    },
    {
      tool: "SendMessage / QueryAgent · Context",
      title: "Take the learning forward.",
      from: "Coordinator → existing Maker",
      avatar: "C",
      message:
        "“Continue with the same Worker. The agreed behavior is in context/index.md.”",
      detail:
        "Reuse a persistent conversation, inspect current state, and load relevant knowledge. The next task starts with what the team learned.",
      statuses: ["Knowledge indexed", "Ready to continue", "Review preserved"],
    },
  ],
  zh: [
    {
      tool: "Task / Fork",
      title: "给每个头脑留出空间。",
      from: "Coordinator → 团队",
      avatar: "C",
      message: "“探索约束，构建一个方案，再从独立的视角检查它。”",
      detail:
        "用 Task 从干净的上下文开始，或通过 Fork 继承有用的历史，探索另一条路径。",
      statuses: ["探索问题的边界", "构建可行路径", "保持独立视角"],
    },
    {
      tool: "SendMessage · Request / reply_to",
      title: "让团队直接交流。",
      from: "Maker ↔ Explorer",
      avatar: "M",
      message: "“导出时需要保留原顺序吗？” → “需要，保留来源中的顺序。”",
      detail:
        "Worker 可以向同伴发起阻塞提问。明确的 reply_to 回答请求，让工作带着确认的决定继续。",
      statuses: ["回答同伴的问题", "已获得明确决定", "准备独立审阅"],
    },
    {
      tool: "独立 Builder + Verifier",
      title: "让结果经得起追问。",
      from: "Verifier → Coordinator",
      avatar: "V",
      message: "“标准来自原始需求。我正在检查实际产物和支持它的证据。”",
      detail:
        "Builder 独立制定验收标准，Verifier 检查真实结果。缺少证据，就再推进一轮。",
      statuses: ["发现已可查阅", "产物准备就绪", "检查实际证据"],
    },
    {
      tool: "SendMessage / QueryAgent · Context",
      title: "带着学到的继续。",
      from: "Coordinator → 已有 Maker",
      avatar: "C",
      message:
        "“延续同一位 Worker。之前确认的行为，已记录在 context/index.md。”",
      detail:
        "延续已有对话，查看当前状态，按需加载共享知识。下一个任务，从团队已经学到的地方开始。",
      statuses: ["知识进入共享索引", "准备继续下一步", "保留审阅结论"],
    },
  ],
};

const textElements = [...document.querySelectorAll("[data-i18n]")];
for (const element of textElements) {
  translations.en[element.dataset.i18n] = [...element.childNodes]
    .map((node) => (node.nodeName === "BR" ? "\n" : node.textContent))
    .join("");
}
const ariaElements = [...document.querySelectorAll("[data-i18n-aria]")];
for (const element of ariaElements)
  translations.en[element.dataset.i18nAria] =
    element.getAttribute("aria-label");

let language = "en";
let currentStep = 0;
let replayTimer;
let copyTimer;
const stage = document.querySelector(".collaboration-stage");
const steps = [...document.querySelectorAll("[data-demo-step]")];
const languageButton = document.getElementById("language-toggle");
const copyButton = document.getElementById("copy-install");

function setText(element, value) {
  const lines = value.split("\n");
  const content = [];
  lines.forEach((line, index) => {
    if (index) content.push(document.createElement("br"));
    content.push(document.createTextNode(line));
  });
  element.replaceChildren(...content);
}

function showStep(index, announce = false) {
  currentStep = index;
  const demo = demos[language][index];
  stage.dataset.step = String(index);
  document.getElementById("demo-tool").textContent = demo.tool;
  document.querySelector("[data-demo-title]").textContent = demo.title;
  document.getElementById("message-routing").textContent = demo.from;
  document.getElementById("message-avatar").textContent = demo.avatar;
  document.getElementById("demo-message").textContent = demo.message;
  document.getElementById("demo-explanation").textContent = demo.detail;
  document.querySelector(".demo-counter").textContent = `0${index + 1} / 04`;
  document
    .querySelectorAll("[data-worker-status]")
    .forEach((element, worker) => {
      element.textContent = demo.statuses[worker];
    });
  steps.forEach((button, step) => {
    button.classList.toggle("is-active", step === index);
    button.setAttribute("aria-pressed", String(step === index));
    button.setAttribute(
      "aria-label",
      language === "zh"
        ? `步骤 ${step + 1}：${demos.zh[step].title}`
        : `Step ${step + 1}: ${demos.en[step].title}`,
    );
  });
  if (announce)
    document.getElementById("demo-announcement").textContent =
      `${index + 1} / 4. ${demo.title} ${demo.message} ${demo.detail}`;
}

function stopReplay() {
  window.clearTimeout(replayTimer);
  replayTimer = undefined;
}

function setLanguage(nextLanguage) {
  language = nextLanguage;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  textElements.forEach((element) =>
    setText(element, translations[language][element.dataset.i18n]),
  );
  ariaElements.forEach((element) =>
    element.setAttribute(
      "aria-label",
      translations[language][element.dataset.i18nAria],
    ),
  );
  languageButton.firstChild.textContent = language === "zh" ? "EN " : "简中 ";
  languageButton.lang = language === "zh" ? "en" : "zh-CN";
  languageButton.setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到简体中文",
  );
  document.title =
    language === "zh"
      ? "MoA+ — 让智慧，在协作中生长。"
      : "MoA+ — Intelligence, in good company.";
  document.getElementById("copy-status").textContent = "";
  window.clearTimeout(copyTimer);
  showStep(currentStep);
  try {
    localStorage.setItem("moa-language", language);
  } catch {
    /* Language still works without local storage. */
  }
}

languageButton.addEventListener("click", () =>
  setLanguage(language === "en" ? "zh" : "en"),
);
steps.forEach((button) =>
  button.addEventListener("click", () => {
    stopReplay();
    showStep(Number(button.dataset.demoStep), true);
  }),
);

document.getElementById("replay-demo").addEventListener("click", () => {
  stopReplay();
  showStep(0, true);
  const nextStep = () => {
    if (currentStep < 3) {
      showStep(currentStep + 1, true);
      replayTimer = window.setTimeout(nextStep, 4500);
    }
  };
  replayTimer = window.setTimeout(nextStep, 4500);
});

async function copyCommands() {
  const commands = document.getElementById("install-commands").textContent;
  let copied = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(commands);
      copied = true;
    } catch {
      /* Use the selection-based clipboard fallback below. */
    }
  }
  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = commands;
    textarea.readOnly = true;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(textarea);
    textarea.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    textarea.remove();
    copyButton.focus({ preventScroll: true });
  }
  const status = document.getElementById("copy-status");
  if (copied) {
    const label = language === "zh" ? "已复制" : "Copied!";
    copyButton.querySelector("span").textContent = label;
    status.textContent =
      language === "zh"
        ? "安装命令已复制到剪贴板。"
        : "Installation commands copied to clipboard.";
  } else {
    const code = document.getElementById("install-commands");
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    code.parentElement.focus({ preventScroll: true });
    const message =
      language === "zh" ? "已选中，请按 ⌘/Ctrl+C" : "Selected — press ⌘/Ctrl+C";
    copyButton.querySelector("span").textContent = message;
    status.textContent = message;
  }
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copyButton.querySelector("span").textContent = translations[language].copy;
  }, 3500);
}
copyButton.addEventListener("click", copyCommands);

try {
  if (localStorage.getItem("moa-language") === "zh") setLanguage("zh");
} catch {
  /* Default to English when storage is unavailable. */
}
showStep(0);
