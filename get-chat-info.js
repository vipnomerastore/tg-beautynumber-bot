// get-chat-info.js - скрипт для получения информации о чате/канале
require("dotenv").config();
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN || "";

async function getChatInfo() {
  const bot = new Telegraf(BOT_TOKEN);
  
  console.log("=== ИНФОРМАЦИЯ О ЧАТАХ ===");
  
  // Проверяем текущий TARGET_CHAT_ID
  const targetId = process.env.TARGET_CHAT_ID;
  if (targetId) {
    try {
      console.log(`\nПроверяю TARGET_CHAT_ID: ${targetId}`);
      const chat = await bot.telegram.getChat(targetId);
      console.log(`  Тип: ${chat.type}`);
      console.log(`  Название: ${chat.title || chat.first_name}`);
      console.log(`  Username: ${chat.username ? '@' + chat.username : 'нет'}`);
      console.log(`  ID: ${chat.id}`);
      
      if (chat.type === 'private') {
        console.log("  ⚠️  ВНИМАНИЕ: Это приватный чат с пользователем!");
        console.log("  ⚠️  Объявления будут отправляться в личные сообщения!");
      }
    } catch (e) {
      console.log(`  ❌ Ошибка: ${e.description || e.message}`);
    }
  }
  
  // Проверяем EXTRA_CHAT_IDS
  const extraIds = process.env.EXTRA_CHAT_IDS;
  if (extraIds) {
    const ids = extraIds.split(',').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
      try {
        console.log(`\nПроверяю EXTRA_CHAT_ID: ${id}`);
        const chat = await bot.telegram.getChat(id);
        console.log(`  Тип: ${chat.type}`);
        console.log(`  Название: ${chat.title || chat.first_name}`);
        console.log(`  Username: ${chat.username ? '@' + chat.username : 'нет'}`);
        console.log(`  ID: ${chat.id}`);
      } catch (e) {
        console.log(`  ❌ Ошибка: ${e.description || e.message}`);
      }
    }
  }
  
  console.log("\n=== КАК ПОЛУЧИТЬ ID КАНАЛА ===");
  console.log("1. Добавьте бота в ваш канал как администратора");
  console.log("2. Перешлите любое сообщение из канала боту @userinfobot");
  console.log("3. Он покажет вам правильный ID канала (начинается с -100)");
  console.log("4. Укажите этот ID в TARGET_CHAT_ID или EXTRA_CHAT_IDS");
  
  process.exit(0);
}

getChatInfo().catch(console.error);
