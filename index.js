// index.js
require("dotenv").config();

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
console.log("TARGET_CHAT_ID:", TARGET_CHAT_ID);
console.log("EXTRA_CHAT_IDS:", process.env.EXTRA_CHAT_IDS);
console.log("CHAT_TARGETS:", CHAT_TARGETS);

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

// Форматирование списка каналов для отображения пользователю
function formatChannelsList() {
  if (CHAT_TARGETS.length === 0) return "";
  
  console.log('[formatChannelsList] Все цели:', CHAT_TARGETS);
  
  const channelNames = CHAT_TARGETS
    .filter(target => {
      // Показываем только каналы (начинающиеся с @) или каналы с ID начинающиеся с -100
      if (target.startsWith('@')) {
        console.log('[formatChannelsList] Включаем канал по @:', target);
        return true;
      }
      // Исключаем ID личных чатов (обычно положительные числа меньше миллиарда)
      if (/^-?\d+$/.test(target)) {
        const id = Number(target);
        const isChannel = id < -1000000000; // -1,000,000,000
        console.log(`[formatChannelsList] ID ${target}: ${isChannel ? 'канал' : 'личный чат'} (исключаем: ${!isChannel})`);
        return isChannel;
      }
      console.log('[formatChannelsList] Неизвестный формат, исключаем:', target);
      return false;
    })
    .map(target => {
      // Если это username канала (начинается с @), отображаем как есть
      if (target.startsWith('@')) {
        return target;
      }
      // Для числовых ID каналов можем попробовать получить username
      // Пока просто отображаем ID
      return target;
    });
  
  console.log('[formatChannelsList] Итоговый список для пользователя:', channelNames);
  return channelNames.join(", ");
}

// ───────────────────────────────────────────────────────────────────────────────
// REQUIRED SUBSCRIPTIONS (перед публикацией нужно быть подписанным)

const REQUIRED_CHANNELS = ["@vipstoresim", "@nomera_russian"];

/** проверка членства пользователя в канале */
async function isChannelMember(tg, channel, userId) {
  try {
    console.log(
      `[checkSub] Проверяю подписку пользователя ${userId} на канал ${channel}`
    );
    const m = await tg.getChatMember(channel, userId);
    const validStatuses = ["creator", "administrator", "member"];
    const isValid = validStatuses.includes(m.status);
    console.log(
      `[checkSub] ${channel} для пользователя ${userId}: ${m.status} (${
        isValid ? "OK" : "НЕТ"
      })`
    );
    return isValid;
  } catch (e) {
    const errorMsg = e?.description || e?.message || e;
    console.error(
      "[checkSub] getChatMember failed:",
      channel,
      "user:",
      userId,
      "error:",
      errorMsg
    );

    // Если ошибка "user not found" - пользователь точно не подписан
    if (
      errorMsg.includes("user not found") ||
      errorMsg.includes("USER_NOT_PARTICIPANT")
    ) {
      console.log(
        `[checkSub] Пользователь ${userId} определённо НЕ участник канала ${channel}`
      );
      return false;
    }

    // Если ошибка "chat not found" - возможно неверный username канала
    if (errorMsg.includes("chat not found")) {
      console.error(
        `[checkSub] ВНИМАНИЕ: Канал ${channel} не найден! Проверьте username.`
      );
      return false;
    }

    // При других ошибках считаем что пользователь не подписан
    return false;
  }
}

/** вернуть список каналов, на которые пользователь еще НЕ подписан */
async function getMissingSubs(tg, userId) {
  console.log(`[getMissingSubs] Проверяю подписки для пользователя ${userId}`);
  const missing = [];
  for (const ch of REQUIRED_CHANNELS) {
    const ok = await isChannelMember(tg, ch, userId);
    if (!ok) {
      missing.push(ch);
      console.log(
        `[getMissingSubs] Пользователь ${userId} НЕ подписан на ${ch}`
      );
    } else {
      console.log(`[getMissingSubs] Пользователь ${userId} подписан на ${ch}`);
    }
  }
  console.log(
    `[getMissingSubs] Итого не хватает подписок: ${missing.length} из ${REQUIRED_CHANNELS.length}`
  );
  return missing;
}

/** клавиатура «подпишись и проверь» */
function subscribeKeyboard(channels) {
  console.log(
    `[subscribeKeyboard] Создаю клавиатуру для каналов: ${channels.join(", ")}`
  );
  const rows = channels.map((ch) => {
    const url = `https://t.me/${String(ch).replace("@", "")}`;
    console.log(`[subscribeKeyboard] Канал ${ch} -> URL: ${url}`);
    return [Markup.button.url(`➕ Подписаться: ${ch}`, url)];
  });
  rows.push([Markup.button.callback("✅ Я подписался — проверить", "chk_sub")]);
  console.log(
    `[subscribeKeyboard] Клавиатура создана с ${rows.length} кнопками`
  );
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
    console.log(
      `[SELL] Финальный шаг для пользователя ${ctx.from.id}, данные:`,
      ctx.callbackQuery?.data
    );
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;

    // Отвечаем на callback query
    try {
      await ctx.answerCbQuery();
    } catch (e) {
      console.log(`[SELL] Ошибка answerCbQuery:`, e.message);
    }

    // Обработка кнопки "Я подписался - проверить"
    if (data === "chk_sub") {
      console.log(`[SELL] Проверка подписки для пользователя ${ctx.from.id}`);

      const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
      if (missing.length) {
        console.log(
          `[SELL] Пользователь ${
            ctx.from.id
          } всё ещё не подписан на: ${missing.join(", ")}`
        );

        // Пробуем показать alert
        try {
          await ctx.answerCbQuery(
            `❌ Ещё нет подписки на: ${missing.join(", ")}`,
            {
              show_alert: true,
            }
          );
        } catch (e) {
          console.log(`[SELL] Не удалось показать alert:`, e.message);
        }

        // Дополнительно отправляем обычное сообщение
        try {
          await ctx.replyWithHTML(
            `❌ <b>Подписка не завершена!</b>\n\n` +
              `Вы ещё не подписаны на: <b>${missing.join(", ")}</b>\n\n` +
              `Подпишитесь на указанные каналы и нажмите кнопку ещё раз.`
          );
          console.log(`[SELL] Отправлено сообщение о недостающих подписках`);
        } catch (e) {
          console.error(`[SELL] Ошибка отправки сообщения о подписках:`, e);
        }

        return;
      }

      console.log(`[SELL] Пользователь ${ctx.from.id} подписан на все каналы!`);

      // Получаем сохранённые данные объявления
      const d = ctx.wizard.state;
      const post = d.__pendingPost;

      if (post) {
        console.log(
          `[SELL] Публикую объявление для пользователя ${ctx.from.id}`
        );
        try {
          const sent = await sendToAll(ctx.telegram, post, {
            parse_mode: "HTML",
          });
          if (sent) {
            try {
              await ctx.editMessageText(
                "✅ Подписка подтверждена. Объявление опубликовано!"
              );
            } catch (editErr) {
              console.log(
                `[SELL] Не удалось отредактировать сообщение:`,
                editErr.message
              );
            }

            await ctx.replyWithHTML(
              `✅ <b>Объявление успешно опубликовано!</b>\n\n` +
              `📢 Опубликовано в каналах: <b>${formatChannelsList()}</b>`,
              mainMenu()
            );
            console.log(
              `[SELL] Успешно опубликовано объявление для пользователя ${ctx.from.id}`
            );
          } else {
            await ctx.replyWithHTML(
              "⚠️ Нет целей публикации. Проверьте настройки бота.",
              mainMenu()
            );
          }
        } catch (e) {
          console.error(
            `[SELL] Ошибка публикации объявления для пользователя ${ctx.from.id}:`,
            e
          );
          await ctx.replyWithHTML(
            "❌ Не удалось опубликовать объявление. Попробуйте ещё раз.",
            mainMenu()
          );
        }

        // Очищаем временные данные
        delete d.__pendingPost;
        delete d.__intent;
        return ctx.scene.leave();
      } else {
        console.log(`[SELL] Нет сохранённого объявления для публикации`);
        await ctx.answerCbQuery("❌ Нет данных для публикации", {
          show_alert: true,
        });
        return;
      }
    }

    if (data === "sell_confirm") {
      console.log(
        `[SELL] Подтверждение продажи от пользователя ${ctx.from.id}`
      );
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
        console.log(
          `[SELL] Пользователь ${
            ctx.from.id
          } не подписан на каналы: ${missing.join(", ")}`
        );
        ctx.wizard.state.__pendingPost = post;
        ctx.wizard.state.__intent = "sell";

        // Также сохраняем в сессии для доступа из обработчика кнопки
        ctx.session.__state = {
          __pendingPost: post,
          __intent: "sell",
        };

        console.log(
          `[SELL] Отправляю сообщение о необходимости подписки пользователю ${ctx.from.id}`
        );
        try {
          await ctx.replyWithHTML(
            "📢 <b>Для публикации объявления нужно подписаться на наши каналы:</b>\n\n" +
              "Подпишитесь на каналы ниже и нажмите «✅ Я подписался — проверить»:",
            subscribeKeyboard(missing)
          );
          console.log(
            `[SELL] Сообщение о подписке успешно отправлено пользователю ${ctx.from.id}`
          );
        } catch (e) {
          console.error(
            `[SELL] Ошибка отправки сообщения о подписке пользователю ${ctx.from.id}:`,
            e
          );
        }
        return; // остаёмся в шаге
      }

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.replyWithHTML(
            `✅ <b>Объявление отправлено на публикацию!</b>\n\n` +
            `📢 Опубликовано в каналах: <b>${formatChannelsList()}</b>`,
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
      "📡 Выберите <b>оператора</b> или введите вручную:",
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
    console.log(
      `[BUY] Финальный шаг для пользователя ${ctx.from.id}, данные:`,
      ctx.callbackQuery?.data
    );
    if (!ctx.callbackQuery?.data) return;
    const data = ctx.callbackQuery.data;

    // Отвечаем на callback query
    try {
      await ctx.answerCbQuery();
    } catch (e) {
      console.log(`[BUY] Ошибка answerCbQuery:`, e.message);
    }

    // Обработка кнопки "Я подписался - проверить"
    if (data === "chk_sub") {
      console.log(`[BUY] Проверка подписки для пользователя ${ctx.from.id}`);

      const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
      if (missing.length) {
        console.log(
          `[BUY] Пользователь ${
            ctx.from.id
          } всё ещё не подписан на: ${missing.join(", ")}`
        );

        // Пробуем показать alert
        try {
          await ctx.answerCbQuery(
            `❌ Ещё нет подписки на: ${missing.join(", ")}`,
            {
              show_alert: true,
            }
          );
        } catch (e) {
          console.log(`[BUY] Не удалось показать alert:`, e.message);
        }

        // Дополнительно отправляем обычное сообщение
        try {
          await ctx.replyWithHTML(
            `❌ <b>Подписка не завершена!</b>\n\n` +
              `Вы ещё не подписаны на: <b>${missing.join(", ")}</b>\n\n` +
              `Подпишитесь на указанные каналы и нажмите кнопку ещё раз.`
          );
          console.log(`[BUY] Отправлено сообщение о недостающих подписках`);
        } catch (e) {
          console.error(`[BUY] Ошибка отправки сообщения о подписках:`, e);
        }

        return;
      }

      console.log(`[BUY] Пользователь ${ctx.from.id} подписан на все каналы!`);

      // Получаем сохранённые данные заявки
      const d = ctx.wizard.state;
      const post = d.__pendingPost;

      if (post) {
        console.log(`[BUY] Публикую заявку для пользователя ${ctx.from.id}`);
        try {
          const sent = await sendToAll(ctx.telegram, post, {
            parse_mode: "HTML",
          });
          if (sent) {
            try {
              await ctx.editMessageText(
                "✅ Подписка подтверждена. Заявка опубликована!"
              );
            } catch (editErr) {
              console.log(
                `[BUY] Не удалось отредактировать сообщение:`,
                editErr.message
              );
            }

            await ctx.replyWithHTML(
              `✅ <b>Заявка успешно отправлена!</b>\n\n` +
              `📢 Опубликована в каналах: <b>${formatChannelsList()}</b>`,
              mainMenu()
            );
            console.log(
              `[BUY] Успешно опубликована заявка для пользователя ${ctx.from.id}`
            );
          } else {
            await ctx.replyWithHTML(
              "⚠️ Нет целей публикации. Проверьте настройки бота.",
              mainMenu()
            );
          }
        } catch (e) {
          console.error(
            `[BUY] Ошибка публикации заявки для пользователя ${ctx.from.id}:`,
            e
          );
          await ctx.replyWithHTML(
            "❌ Не удалось опубликовать заявку. Попробуйте ещё раз.",
            mainMenu()
          );
        }

        // Очищаем временные данные
        delete d.__pendingPost;
        delete d.__intent;
        return ctx.scene.leave();
      } else {
        console.log(`[BUY] Нет сохранённой заявки для публикации`);
        await ctx.answerCbQuery("❌ Нет данных для публикации", {
          show_alert: true,
        });
        return;
      }
    }

    if (data === "buy_confirm") {
      console.log(`[BUY] Подтверждение покупки от пользователя ${ctx.from.id}`);
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
        console.log(
          `[BUY] Пользователь ${
            ctx.from.id
          } не подписан на каналы: ${missing.join(", ")}`
        );
        ctx.wizard.state.__pendingPost = post;
        ctx.wizard.state.__intent = "buy";

        // Также сохраняем в сессии для доступа из обработчика кнопки
        ctx.session.__state = {
          __pendingPost: post,
          __intent: "buy",
        };

        console.log(
          `[BUY] Отправляю сообщение о необходимости подписки пользователю ${ctx.from.id}`
        );
        try {
          await ctx.replyWithHTML(
            "📢 <b>Для отправки заявки нужно подписаться на наши каналы:</b>\n\n" +
              "Подпишитесь на каналы ниже и нажмите «✅ Я подписался — проверить»:",
            subscribeKeyboard(missing)
          );
          console.log(
            `[BUY] Сообщение о подписке успешно отправлено пользователю ${ctx.from.id}`
          );
        } catch (e) {
          console.error(
            `[BUY] Ошибка отправки сообщения о подписке пользователю ${ctx.from.id}:`,
            e
          );
        }
        return; // остаёмся в шаге
      }

      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.replyWithHTML(
            `✅ <b>Заявка отправлена на обработку!</b>\n\n` +
            `📢 Опубликована в каналах: <b>${formatChannelsList()}</b>`,
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
    // Игнорируем сообщения от ботов
    if (ctx.from.is_bot) {
      console.log("Игнорирую сообщение от бота:", ctx.from.id);
      return;
    }

    // Игнорируем сообщения в группах/каналах (только приватные чаты)
    if (ctx.chat.type !== "private") {
      console.log("Игнорирую сообщение из группы/канала:", ctx.chat.id);
      return;
    }

    if (ctx.scene?.current) return next();
    return sendWelcome(ctx);
  });

  // Отладочный обработчик для всех callback query
  bot.on("callback_query", async (ctx, next) => {
    console.log(
      `[callback_query] Получен callback от пользователя ${ctx.from.id}: ${ctx.callbackQuery.data}`
    );
    return next();
  });

  // Кнопка «Я подписался — проверить» теперь обрабатывается внутри wizard'ов

  try {
    console.log("Попытка удаления webhook...");
    await bot.telegram.deleteWebhook();
    console.log("Webhook успешно удален");
  } catch (e) {
    console.warn(
      "Не удалось удалить webhook (можно игнорировать):",
      e?.description || e?.message || e
    );
  }

  console.log("Запуск бота в режиме long polling...");
  await bot.launch({ dropPendingUpdates: true });
  console.log("Бот запущен (long polling).");
  console.log("Цели для публикации:", CHAT_TARGETS);

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

bootstrap().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
