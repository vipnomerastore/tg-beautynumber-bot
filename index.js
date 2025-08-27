bot.action("chk_sub", async (ctx) => {
  try {
    const missing = await getMissingSubs(ctx.telegram, ctx.from.id);
    if (missing.length) {
      await ctx.answerCbQuery(`Ещё нет подписки на: ${missing.join(", ")}`, {
        show_alert: false,
      });
      return;
    }

    // если есть заготовленный пост из сцены — публикуем автоматически
    const st = ctx.scene?.state;
    const post = st?.__pendingPost;
    if (post) {
      try {
        const sent = await sendToAll(ctx.telegram, post, {
          parse_mode: "HTML",
        });
        if (sent) {
          await ctx.editMessageText(
            "✅ Подписка подтверждена. Сообщение опубликовано."
          );
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
      // очистим и выйдем из сцены
      delete st.__pendingPost;
      delete st.__intent;
      return ctx.scene.leave();
    }

    // иначе — просто подтверждаем
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
