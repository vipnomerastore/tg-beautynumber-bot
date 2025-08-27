// index.js
require("dotenv").config({
  path: "/opt/tg-beautynumber-bot/.env",
  override: true,
});

const { Telegraf, Scenes, session, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TARGET_CHAT_ID = Number(process.env.TARGET_CHAT_ID || 0);

// Доп. цели: @username или числовые ID через запятую
const RAW_EXTRA = (process.env.EXTRA_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Итоговый список целей
const CHAT_TARGETS = Array.from(
  new Set(
    [TARGET_CHAT_ID ? String(TARGET_CHAT_ID) : null, ...RAW_EXTRA].filter(
      Boolean
    )
  )
);

// Диагностика токена
console.log("BOT_TOKEN length:", BOT_TOKEN.length);
console.log("BOT_TOKEN has whitespace?", /\s/.test(BOT_TOKEN));

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

// Универсальная отправка во все цели
async function sendToAll(tg, text, extra) {
  if (CHAT_TARGETS.length === 0) return false;
  console.log("[sendToAll] targets:", CHAT_TARGETS.join(", "));
  let ok = false;
  for (const target of CHAT_TARGETS) {
    try {
      const chatId = /^-?\d+$/.test(target) ? Number(target) : target;
      await tg.sendMessage(chatId, text, extra);
      ok = true;
      console.log("[sendToAll] sent ->", target);
    } catch (e) {
      console.error(
        "[sendToAll] error ->",
        target,
        e?.description || e?.message || e
      );
    }
  }
  return ok;
}

// ───────────────────────────────────────────────────────────────────────────────
// REQUIRED SUBSCRIPTIONS (перед публикацией нужно быть подписанным)

const REQUIRED_CHANNELS = ["@vipstoresim", "@nomera_russian"];

/** проверка членства пользователя в канале */
async function isChannelMember(tg, channel, userId) {
  try {
    const m = await tg.getChatMember(channel, userId);
    return ["creator", "administrator", "member"].includes(m.status);
  } catch (e) {
    console.error(
      "[checkSub] getChatMember failed:",
      channel,
      e?.description || e?.message || e
    );
    return false;
  }
}

/** вернуть список каналов, на которые пользователь еще НЕ подписан */
async function getMissingSubs(tg, userId) {
  const missing = [];
  for (const ch of REQUIRED_CHANNELS) {
    const ok = await isChannelMember(tg, ch, userId);
    if (!ok) missing.push(ch);
  }
  return missing;
}

/** клавиатура «подпишись и проверь» */
function subscribeKeyboard(channels) {
  const rows = channels.map((ch) => {
    const url = `https://t.me/${String(ch).replace("@", "")}`;
    return [Markup.button.url(`➕ Подписаться: ${ch}`, url)];
  });
  rows.push([Markup.button.callback("✅ Я подписался — проверить", "chk_sub")]);
  return Markup.inlineKeyboard(rows);
}

// ───────────────────────────────────────────────────────────────────────────────
// UI

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
      Markup.button.callback("Tele2", "op|Tele2"),
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
// SELL

const sellWizard = new Scenes.WizardScene(
  "sell-wizard",

  async (ctx) => {
    await ctx.replyWithHTML(
      "✨ <b>Продажа красивого номера</b>\n\nВыберите <b>оператора</b> или введите вручную:",
      operatorInlineKeyboard()
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data?.startsWith("op|")) {
      const val = ctx.callbackQuery.data.split("|")[1];
      await ctx.answerCbQuery();
      if (val === "other") {
        await ctx.replyWithHTML("Введите название оператора:");
        return;
      } else {
        ctx.wizard.state.operator = val;
      }
    } else if (ctx.message?.text) {
      ctx.wizard.state.operator = ctx.message.text.trim();
    } else return;

    await ctx.replyWithHTML("🗺️ Укажите <b>регион номера</b>:");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.region = ctx.message.text.trim();
    await ctx.replyWithHTML("🔢 Введите <b>номер</b> (без пробелов):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.number = ctx.message.text.trim();
    await ctx.replyWithHTML("💰 Укажите <b>цену</b> (в рублях):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.price = ctx.message.text.trim();
    await ctx.replyWithHTML(
      "📞 <b>Контакт для связи</b> (телеграм / телефон):"
    );
    return ctx.wizard.next();
  },

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

    await ctx.replyWithHTML(
      "🔎 <b>Проверьте объявление</b> и подтвердите публикацию:"
    );
    await ctx.replyWithHTML(preview, confirmKeyboard("sell"));
    return ctx.wizard.next();
  },

  // финальный шаг: проверка подписок → публикация
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

      const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
      if (missing.length) {
        ctx.wizard.state.__pendingPost = post;
        ctx.wizard.state.__intent = "sell";
        await ctx.replyWithHTML(
          "Чтобы опубликовать объявление, подпишитесь на каналы и нажмите «проверить»:",
          subscribeKeyboard(missing)
        );
        return; // остаёмся в шаге
      }

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.replyWithHTML(
            "✅ Объявление отправлено на публикацию!",
            mainMenu()
          );
        } else {
          await ctx.replyWithHTML(
            "⚠️ Нет целей публикации. Проверьте TARGET_CHAT_ID/EXTRA_CHAT_IDS.",
            mainMenu()
          );
        }
      } catch (e) {
        console.error("Ошибка отправки:", e);
        await ctx.replyWithHTML(
          "❌ Не удалось отправить объявление. Проверьте права бота и ID чата.",
          mainMenu()
        );
      }
      return ctx.scene.leave();
    } else if (data === "sell_cancel") {
      await ctx.replyWithHTML("❎ Публикация отменена.", mainMenu());
      return ctx.scene.leave();
    }
  }
);

sellWizard.command("cancel", async (ctx) => {
  await ctx.replyWithHTML("Операция отменена.", mainMenu());
  return ctx.scene.leave();
});

// ───────────────────────────────────────────────────────────────────────────────
// BUY

const buyWizard = new Scenes.WizardScene(
  "buy-wizard",

  async (ctx) => {
    await ctx.replyWithHTML(
      "🛒 <b>Заявка на покупку номера</b>\n\n" +
        "✍️ <b>Какой номер ищите?</b>\n" +
        "Например: <code>9999 на конце</code>, <code>***7777</code>, <code>красивый код</code>"
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.pattern = ctx.message.text.trim();
    await ctx.replyWithHTML(
      "📡 Выберите <b>оператора</б> или введите вручную:",
      operatorInlineKeyboard()
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.callbackQuery?.data?.startsWith("op|")) {
      const val = ctx.callbackQuery.data.split("|")[1];
      await ctx.answerCbQuery();
      if (val === "other") {
        await ctx.replyWithHTML("Введите название оператора:");
        return;
      } else {
        ctx.wizard.state.operator = val;
      }
    } else if (ctx.message?.text) {
      ctx.wizard.state.operator = ctx.message.text.trim();
    } else return;

    await ctx.replyWithHTML(
      "💰 <b>Какой бюджет?</b> (руб.)\nНапример: <code>12000</code>"
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.budget = ctx.message.text.trim();
    await ctx.replyWithHTML(
      "🗺️ <b>Регион номера</b> (если нет — введите прочерк):"
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.region = ctx.message.text.trim();
    await ctx.replyWithHTML(
      "📞 <b>Контакт для связи</b> (телеграм / телефон):"
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.contact = ctx.message.text.trim();
    await ctx.replyWithHTML("📝 <b>Комментарий</b> (необязательно):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.comment = ctx.message.text.trim();

    const d = ctx.wizard.state;
    const preview =
      "🔎 <b>Заявка на покупку красивого номера</b>\n" +
      `Ищу номер: <b>${escapeHTML(d.pattern)}</b>\n` +
      `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
      `Бюджет: <b>${escapeHTML(formatRUB(d.budget))}</b>\n` +
      `Регион: <b>${escapeHTML(d.region)}</b>\n` +
      `Контакт: <b>${escapeHTML(d.contact)}</b>\n` +
      `Комментарий: <b>${escapeHTML(d.comment)}</b>`;

    await ctx.replyWithHTML(
      "🔎 <b>Проверьте заявку</b> и подтвердите отправку:"
    );
    await ctx.replyWithHTML(preview, confirmKeyboard("buy"));
    return ctx.wizard.next();
  },

  // финальный шаг: проверка подписок → публикация
  async (ctx) => {
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    if (data === "buy_confirm") {
      const d = ctx.wizard.state;
      const post =
        "🔎 <b>Заявка на покупку красивого номера</b>\n" +
        `Ищу номер: <b>${escapeHTML(d.pattern)}</b>\n` +
        `Оператор: <b>${escapeHTML(d.operator)}</b>\n` +
        `Бюджет: <b>${escapeHTML(formatRUB(d.budget))}</b>\n` +
        `Регион: <b>${escapeHTML(d.region)}</b>\n` +
        `Контакт: <b>${escapeHTML(d.contact)}</b>\n` +
        `Комментарий: <b>${escapeHTML(d.comment)}</b>`;

      const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
      if (missing.length) {
        ctx.wizard.state.__pendingPost = post;
        ctx.wizard.state.__intent = "buy";
        await ctx.replyWithHTML(
          "Чтобы отправить заявку, подпишитесь на каналы и нажмите «проверить»:",
          subscribeKeyboard(missing)
        );
        return; // остаёмся в шаге
      }

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.replyWithHTML(
            "✅ Заявка отправлена на обработку!",
            mainMenu()
          );
        } else {
          await ctx.replyWithHTML(
            "⚠️ Нет целей публикации. Проверьте TARGET_CHAT_ID/EXTRA_CHAT_IDS.",
            mainMenu()
          );
        }
      } catch (e) {
        console.error("Ошибка отправки:", e);
        await ctx.replyWithHTML(
          "❌ Не удалось отправить заявку. Проверьте права бота и ID чата.",
          mainMenu()
        );
      }
      return ctx.scene.leave();
    } else if (data === "buy_cancel") {
      await ctx.replyWithHTML("❎ Заявка отменена.", mainMenu());
      return ctx.scene.leave();
    }
  }
);

buyWizard.command("cancel", async (ctx) => {
  await ctx.replyWithHTML("Операция отменена.", mainMenu());
  return ctx.scene.leave();
});

// ───────────────────────────────────────────────────────────────────────────────
// Bootstrap

async function bootstrap() {
  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 30_000 });

  const stage = new Scenes.Stage([sellWizard, buyWizard]);
  bot.use(session());
  bot.use(stage.middleware());

  const sendWelcome = async (ctx) => {
    const text =
      "👋 <b>Добро пожаловать!</b>\n" +
      "Я помогу <b>продать</b> или <b>купить</b> красивый номер.\n\n" +
      "Выберите действие в меню ниже:";
    await ctx.replyWithHTML(text, mainMenu());
  };

  bot.start(sendWelcome);
  bot.command("menu", sendWelcome);

  bot.hears("ℹ️ Помощь", async (ctx) => {
    await ctx.replyWithHTML(
      "📖 <b>Помощь</b>\n" +
        "• Нажмите <b>🟢 Продать</b>, чтобы разместить объявление.\n" +
        "• Нажмите <b>🔎 Купить</b>, чтобы оставить заявку на покупку.\n" +
        "• В любой момент можно ввести <b>/cancel</b> для отмены.\n" +
        "• Команда <b>/menu</b> возвращает в главное меню."
    );
  });

  bot.hears("🟢 Продать", (ctx) => ctx.scene.enter("sell-wizard"));
  bot.hears("🔎 Купить", (ctx) => ctx.scene.enter("buy-wizard"));

  bot.command("sell", (ctx) => ctx.scene.enter("sell-wizard"));
  bot.command("buy", (ctx) => ctx.scene.enter("buy-wizard"));

  bot.command("cancel", async (ctx) => {
    if (ctx.scene?.current) {
      await ctx.replyWithHTML("Операция отменена.", mainMenu());
      return ctx.scene.leave();
    }
    await sendWelcome(ctx);
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.scene?.current) return next();
    return sendWelcome(ctx);
  });

  // Кнопка «Я подписался — проверить» (ВНУТРИ bootstrap)
  bot.action("chk_sub", async (ctx) => {
    try {
      const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
      if (missing.length) {
        await ctx.answerCbQuery(`Ещё нет подписки на: ${missing.join(", ")}`, {
          show_alert: false,
        });
        return;
      }
      const st = ctx.scene?.state;
      const post = st?.__pendingPost;
      if (post) {
        try {
          const sent = await sendToAll(ctx.telegram, post, {
            parse_mode: "HTML",
          });
          if (sent) {
            try {
              await ctx.editMessageText(
                "✅ Подписка подтверждена. Сообщение опубликовано."
              );
            } catch {}
            await ctx.replyWithHTML("Готово! Возврат в меню.", mainMenu());
          } else {
            await ctx.replyWithHTML(
              "⚠️ Нет целей публикации. Проверьте TARGET_CHAT_ID/EXTRA_CHAT_IDS.",
              mainMenu()
            );
          }
        } catch (e) {
          console.error("Ошибка авто-публикации после проверки:", e);
          await ctx.replyWithHTML(
            "❌ Не удалось опубликовать. Попробуйте ещё раз.",
            mainMenu()
          );
        }
        delete st.__pendingPost;
        delete st.__intent;
        return ctx.scene.leave();
      }
      await ctx.answerCbQuery("Подписка подтверждена, можно публиковать.", {
        show_alert: false,
      });
    } catch (e) {
      console.error("chk_sub error:", e);
      await ctx.answerCbQuery("Ошибка проверки. Попробуйте позже.", {
        show_alert: true,
      });
    }
  });

  try {
    await bot.telegram.deleteWebhook();
  } catch (e) {
    console.warn(
      "Не удалось удалить webhook (можно игнорировать):",
      e?.description || e?.message || e
    );
  }

  await bot.launch({ dropPendingUpdates: true });
  console.log("Бот запущен (long polling).");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

bootstrap().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
