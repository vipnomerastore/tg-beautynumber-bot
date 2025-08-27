// index.js
// 1) Грузим .env по абсолютному пути и ПЕРЕЗАПИСЫВАЕМ переменные окружения
require("dotenv").config({
  path: "/opt/tg-beautynumber-bot/.env", // ← при необходимости поменяй путь
  override: true,
});

const { Telegraf, Scenes, session } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TARGET_CHAT_ID = Number(process.env.TARGET_CHAT_ID || 0);

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
if (!TARGET_CHAT_ID) {
  console.warn(
    "WARNING: TARGET_CHAT_ID не задан. Постинг в канал/чат работать не будет."
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Wizard сцена /sell
const sellWizard = new Scenes.WizardScene(
  "sell-wizard",

  async (ctx) => {
    await ctx.reply(
      "Укажите оператора (МТС, Билайн, МегаФон, Tele2):\n(для отмены — /cancel)"
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.operator = ctx.message.text.trim();
    await ctx.reply("Регион или город:");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.region = ctx.message.text.trim();
    await ctx.reply("Введите сам номер (без пробелов):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.number = ctx.message.text.trim();
    await ctx.reply("Цена (руб):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.price = ctx.message.text.trim();
    await ctx.reply("Контакт для связи (телеграм / телефон):");
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.message?.text) return;
    ctx.wizard.state.contact = ctx.message.text.trim();

    const d = ctx.wizard.state;
    const postText =
      "📞 *Продажа красивого номера*\n" +
      `Оператор: ${d.operator}\n` +
      `Регион: ${d.region}\n` +
      `Номер: ${d.number}\n` +
      `Цена: ${d.price}₽\n` +
      `Контакт: ${d.contact}`;

    try {
      if (!TARGET_CHAT_ID) {
        await ctx.reply(
          "(DEV) Сообщение не отправлено: TARGET_CHAT_ID не задан."
        );
      } else {
        await ctx.telegram.sendMessage(TARGET_CHAT_ID, postText, {
          parse_mode: "Markdown",
        });
        await ctx.reply("Спасибо! Ваше объявление отправлено на публикацию.");
      }
    } catch (e) {
      console.error("Ошибка отправки в канал:", e);
      await ctx.reply(
        "Не удалось отправить объявление. Проверьте права бота и ID чата."
      );
    }

    return ctx.scene.leave();
  }
);

// /cancel в сцене
sellWizard.command("cancel", async (ctx) => {
  await ctx.reply("Операция отменена.");
  return ctx.scene.leave();
});

// ───────────────────────────────────────────────────────────────────────────────
// Bootstrap
async function bootstrap() {
  const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 30_000 });

  const stage = new Scenes.Stage([sellWizard]);
  bot.use(session());
  bot.use(stage.middleware());

  bot.start(async (ctx) => {
    await ctx.reply(
      "Привет! Я бот для размещения объявлений о продаже красивых номеров.\n" +
        "Чтобы продать номер, введите /sell. Чтобы оставить запрос на покупку, введите /buy."
    );
  });

  bot.command("buy", async (ctx) => {
    await ctx.reply("Функция покупки пока в разработке.");
  });

  bot.command("sell", async (ctx) => ctx.scene.enter("sell-wizard"));

  // Подсказка для любых текстов вне сцены
  bot.on("text", async (ctx, next) => {
    if (ctx.scene?.current) return next();
    return ctx.reply(
      "Доступные команды: /start, /sell, /buy, /cancel (в диалоге)."
    );
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
