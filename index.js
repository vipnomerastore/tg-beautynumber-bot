// index.js
// 1) Грузим .env по абсолютному пути и ПЕРЕЗАПИСЫВАЕМ переменные окружения
require("dotenv").config({
  path: "/opt/tg-beautynumber-bot/.env", // ← при необходимости поменяй путь
  override: true,
});

const { Telegraf, Scenes, session, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TARGET_CHAT_ID = Number(process.env.TARGET_CHAT_ID || 0);

// Доп. цели рассылки: @username или числовые ID через запятую
const RAW_EXTRA = (process.env.EXTRA_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Итоговый список целей (строками): ['-100...', '@vipstoresim', ...]
const CHAT_TARGETS = Array.from(
  new Set(
    [TARGET_CHAT_ID ? String(TARGET_CHAT_ID) : null, ...RAW_EXTRA].filter(
      Boolean
    )
  )
);

// Диагностика токена (без вывода самого значения)
console.log("BOT_TOKEN length:", BOT_TOKEN.length);
console.log("BOT_TOKEN has whitespace?", /\s/.test(BOT_TOKEN));

// Жёсткая валидация формата токена (ожидается "digits:hash")
const tokenLooksValid = /^\d+:[A-Za-z0-9_\-]{30,}$/.test(BOT_TOKEN);
if (!tokenLooksValid) {
  console.error(
    "Некорректный BOT_TOKEN (ожидается формат digits:hash). Проверь .env"
  );
  process.exit(1);
}
if (CHAT_TARGETS.length === 0) {
  console.warn(
    "WARNING: не задано ни одной цели публикации (TARGET_CHAT_ID/EXTRA_CHAT_IDS)."
  );
}

// Универсальная отправка во ВСЕ цели
async function sendToAll(tg, text, extra) {
  if (CHAT_TARGETS.length === 0) return false;
  let ok = false;
  for (const target of CHAT_TARGETS) {
    try {
      const chatId = /^-?\d+$/.test(target) ? Number(target) : target; // число или @username
      await tg.sendMessage(chatId, text, extra);
      ok = true;
    } catch (e) {
      console.error("Send error ->", target, e?.description || e?.message || e);
    }
  }
  return ok;
}

// ───────────────────────────────────────────────────────────────────────────────
// UI helpers

const OPERATORS = ["МТС", "Билайн", "МегаФон", "Теле 2"];

const mainMenu = () =>
  Markup.keyboard([["🟢 Продать", "🔎 Купить"], ["ℹ️ Помощь"]])
    .resize()
    .persistent();

const operatorInlineKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("МТС", "op|МТС"),
      Markup.button.callback("Билайн", "op|Билайн"),
    ],
    [
      Markup.button.callback("МегаФон", "op|МегаФон"),
      Markup.button.callback("Теле 2", "op|Теле 2"),
    ],
    [Markup.button.callback("✍️ Другое (ввести вручную)", "op|other")],
  ]);

const confirmKeyboard = (prefix) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Опубликовать", `${prefix}_confirm`)],
    [Markup.button.callback("❌ Отмена", `${prefix}_cancel`)],
  ]);

const escapeHTML = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatRUB = (n) => {
  if (n === null || n === undefined || n === "") return "";
  const num = Number(String(n).replace(/[^\d]/g, ""));
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString("ru-RU") + " ₽";
};

// ───────────────────────────────────────────────────────────────────────────────
// SELL scene (мастер-диалог)

const sellWizard = new Scenes.WizardScene(
  "sell-wizard",

  // Step 0 — оператор (кнопки)
  async (ctx) => {
    await ctx.reply(
      "✨ <b>Продажа красивого номера</b>\n\nВыберите <b>оператора</b> или введите вручную:",
      { parse_mode: "HTML", ...operatorInlineKeyboard() }
    );
    return ctx.wizard.next();
  },

  // Step 1 — оператор → регион
  async (ctx) => {
    if (ctx.callbackQuery?.data?.startsWith("op|")) {
      const val = ctx.callbackQuery.data.split("|")[1];
      await ctx.answerCbQuery();
      if (val === "other") {
        await ctx.reply("Введите название оператора:");
        return; // остаёмся на шаге — ждём текст
      } else {
        ctx.wizard.state.operator = val;
      }
    } else if (ctx.message?.text) {
      ctx.wizard.state.operator = ctx.message.text.trim();
    } else {
      return;
    }

    await ctx.reply("🗺️ Укажите <b>регион/город</b>:", { parse_mode: "HTML" });
    return ctx.wizard.next();
  },

  // Step 2 — регион → номер
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.region = ctx.message.text.trim();
    await ctx.reply("🔢 Введите <b>номер</b> (без пробелов):", {
      parse_mode: "HTML",
    });
    return ctx.wizard.next();
  },

  // Step 3 — номер → цена
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.number = ctx.message.text.trim();
    await ctx.reply("💰 Укажите <b>цену</b> (в рублях):", {
      parse_mode: "HTML",
    });
    return ctx.wizard.next();
  },

  // Step 4 — цена → контакт
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.price = ctx.message.text.trim();
    await ctx.reply("📞 <b>Контакт для связи</b> (телеграм / телефон):", {
      parse_mode: "HTML",
    });
    return ctx.wizard.next();
  },

  // Step 5 — предпросмотр + подтверждение
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.contact = ctx.message.text.trim();

    const d = ctx.wizard.state;
    const preview =
      "📞 <b>Продажа красивого номера</b>\n" +
      `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
      `Регион: <b>${escapeHTML(d.region)}</b>\n` +
      `Номер: <b>${escapeHTML(d.number)}</b>\n` +
      `Цена: <b>${escapeHTML(formatRUB(d.price))}</b>\n` +
      `Контакт: <b>${escapeHTML(d.contact)}</b>`;

    await ctx.reply(
      "🔎 <b>Проверьте объявление</b> и подтвердите публикацию:",
      { parse_mode: "HTML" }
    );
    await ctx.reply(preview, {
      parse_mode: "HTML",
      ...confirmKeyboard("sell"),
    });

    return ctx.wizard.next();
  },

  // Step 6 — подтверждение/отмена
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === "sell_confirm") {
      const d = ctx.wizard.state;
      const post =
        "📞 <b>Продажа красивого номера</b>\n" +
        `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
        `Регион: <b>${escapeHTML(d.region)}</b>\n` +
        `Номер: <b>${escapeHTML(d.number)}</b>\n` +
        `Цена: <b>${escapeHTML(formatRUB(d.price))}</b>\n` +
        `Контакт: <b>${escapeHTML(d.contact)}</b>`;

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.reply(
            "✅ Объявление отправлено на публикацию!",
            mainMenu()
          );
        } else {
          await ctx.reply(
            "⚠️ Не задано ни одной цели публикации. Проверьте TARGET_CHAT_ID/EXTRA_CHAT_IDS.",
            mainMenu()
          );
        }
      } catch (e) {
        console.error("Ошибка отправки:", e);
        await ctx.reply(
          "❌ Не удалось отправить объявление. Проверьте права бота и ID чата.",
          mainMenu()
        );
      }
    } else if (data === "sell_cancel") {
      await ctx.reply("❎ Публикация отменена.", mainMenu());
    }

    return ctx.scene.leave();
  }
);

// /cancel для SELL
sellWizard.command("cancel", async (ctx) => {
  await ctx.reply("Операция отменена.", mainMenu());
  return ctx.scene.leave();
});

// ───────────────────────────────────────────────────────────────────────────────
// BUY scene (мастер-диалог)

const buyWizard = new Scenes.WizardScene(
  "buy-wizard",

  // Step 0 — Какой номер ищите
  async (ctx) => {
    await ctx.reply(
      "🛒 <b>Заявка на покупку номера</b>\n\n" +
        "✍️ <b>Какой номер ищите?</b>\nНапример: <code>9999 на конце</code>, <code>***7777</code>, <code>красивый код</code>",
      { parse_mode: "HTML" }
    );
    return ctx.wizard.next();
  },

  // Step 1 — pattern → оператор (кнопки)
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.pattern = ctx.message.text.trim();

    await ctx.reply("📡 Выберите <b>оператора</b> или введите вручную:", {
      parse_mode: "HTML",
      ...operatorInlineKeyboard(),
    });
    return ctx.wizard.next();
  },

  // Step 2 — оператор → бюджет
  async (ctx) => {
    if (ctx.callbackQuery?.data?.startsWith("op|")) {
      const val = ctx.callbackQuery.data.split("|")[1];
      await ctx.answerCbQuery();
      if (val === "other") {
        await ctx.reply("Введите название оператора:");
        return; // ждём текст на этом же шаге
      } else {
        ctx.wizard.state.operator = val;
      }
    } else if (ctx.message?.text) {
      ctx.wizard.state.operator = ctx.message.text.trim();
    } else {
      return;
    }

    await ctx.reply(
      "💰 <b>Какой бюджет?</b> (руб.)\nНапример: <code>12000</code>",
      { parse_mode: "HTML" }
    );
    return ctx.wizard.next();
  },

  // Step 3 — бюджет → регион
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.budget = ctx.message.text.trim();

    await ctx.reply(
      "🗺️ <b>Регион номера</b> (если нет — введите <code>-</code>):",
      { parse_mode: "HTML" }
    );
    return ctx.wizard.next();
  },

  // Step 4 — регион → контакт
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.region = ctx.message.text.trim();

    await ctx.reply("📞 <b>Контакт для связи</b> (телеграм / телефон):", {
      parse_mode: "HTML",
    });
    return ctx.wizard.next();
  },

  // Step 5 — контакт → комментарий
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.contact = ctx.message.text.trim();

    await ctx.reply(
      "📝 <b>Комментарий</b> (необязательно, можно <code>-</code>):",
      {
        parse_mode: "HTML",
      }
    );
    return ctx.wizard.next();
  },

  // Step 6 — предпросмотр + подтверждение
  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.comment = ctx.message.text.trim();

    const d = ctx.wizard.state;
    const preview =
      "🔎 <b>Заявка на покупку красивого номера</b>\n" +
      `Искомый номер: <b>${escapeHTML(d.pattern)}</b>\n` +
      `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
      `Бюджет: <b>${escapeHTML(formatRUB(d.budget))}</b>\n` +
      `Регион: <b>${escapeHTML(d.region)}</b>\n` +
      `Контакт: <b>${escapeHTML(d.contact)}</b>\n` +
      `Комментарий: <b>${escapeHTML(d.comment)}</b>`;

    await ctx.reply("🔎 <b>Проверьте заявку</b> и подтвердите отправку:", {
      parse_mode: "HTML",
    });
    await ctx.reply(preview, { parse_mode: "HTML", ...confirmKeyboard("buy") });
    return ctx.wizard.next();
  },

  // Step 7 — подтверждение/отмена
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === "buy_confirm") {
      const d = ctx.wizard.state;
      const post =
        "🔎 <b>Заявка на покупку красивого номера</b>\n" +
        `Искомый номер: <b>${escapeHTML(d.pattern)}</b>\n` +
        `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
        `Бюджет: <b>${escapeHTML(formatRUB(d.budget))}</b>\n` +
        `Регион: <b>${escapeHTML(d.region)}</b>\n` +
        `Контакт: <b>${escapeHTML(d.contact)}</b>\n` +
        `Комментарий: <b>${escapeHTML(d.comment)}</b>`;

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.reply("✅ Заявка отправлена на обработку!", mainMenu());
        } else {
          await ctx.reply(
            "⚠️ Не задано ни одной цели публикации. Проверьте TARGET_CHAT_ID/EXTRA_CHAT_IDS.",
            mainMenu()
          );
        }
      } catch (e) {
        console.error("Ошибка отправки:", e);
        await ctx.reply(
          "❌ Не удалось отправить заявку. Проверьте права бота и ID чата.",
          mainMenu()
        );
      }
    } else if (data === "buy_cancel") {
      await ctx.reply("❎ Заявка отменена.", mainMenu());
    }

    return ctx.scene.leave();
  }
);

// /cancel для BUY
buyWizard.command("cancel", async (ctx) => {
  await ctx.reply("Операция отменена.", mainMenu());
  return ctx.scene.leave();
});

// ───────────────────────────────────────────────────────────────────────────────
// Bootstrap

async function bootstrap() {
  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 30_000 });

  const stage = new Scenes.Stage([sellWizard, buyWizard]);
  bot.use(session());
  bot.use(stage.middleware());

  // /start и меню
  const sendWelcome = async (ctx) => {
    const text =
      "👋 <b>Добро пожаловать!</b>\n" +
      "Я помогу <b>продать</b> или <b>купить</b> красивый номер.\n\n" +
      "Выберите действие в меню ниже:";
    await ctx.reply(text, { parse_mode: "HTML", ...mainMenu() });
  };

  bot.start(sendWelcome);
  bot.command("menu", sendWelcome);
  bot.hears("ℹ️ Помощь", async (ctx) => {
    await ctx.reply(
      "📖 <b>Помощь</b>\n" +
        "• Нажмите <b>🟢 Продать</b>, чтобы разместить объявление.\n" +
        "• Нажмите <b>🔎 Купить</b>, чтобы оставить заявку на покупку.\n" +
        "• В любой момент можно ввести <b>/cancel</b> для отмены.\n" +
        "• Команда <b>/menu</b> возвращает в главное меню.",
      { parse_mode: "HTML" }
    );
  });

  // Кнопки меню
  bot.hears("🟢 Продать", (ctx) => ctx.scene.enter("sell-wizard"));
  bot.hears("🔎 Купить", (ctx) => ctx.scene.enter("buy-wizard"));

  // Команды
  bot.command("sell", (ctx) => ctx.scene.enter("sell-wizard"));
  bot.command("buy", (ctx) => ctx.scene.enter("buy-wizard"));
  bot.command("cancel", async (ctx) => {
    if (ctx.scene?.current) {
      await ctx.reply("Операция отменена.", mainMenu());
      return ctx.scene.leave();
    }
    await sendWelcome(ctx);
  });

  // Фоллбек: подсказываем про меню, если не в сцене
  bot.on("text", async (ctx, next) => {
    if (ctx.scene?.current) return next();
    return sendWelcome(ctx);
  });

  // На всякий случай удаляем webhook (мы на long polling)
  try {
    await bot.telegram.deleteWebhook();
  } catch (e) {
    console.warn(
      "Не удалось удалить webhook (можно игнорировать):",
      e?.description || e?.message || e
    );
  }

  // ВАЖНО: сначала запускаем бота, потом лог об успешном запуске
  await bot.launch({ dropPendingUpdates: true });
  console.log("Бот запущен (long polling).");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

bootstrap().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
