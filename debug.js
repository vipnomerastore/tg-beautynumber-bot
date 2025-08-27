// debug.js - скрипт для тестирования проверки подписок
require("dotenv").config();
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TEST_USER_ID = process.env.TEST_USER_ID || "792721484"; // ID пользователя для тестирования
const REQUIRED_CHANNELS = ["@vipstoresim", "@nomera_russian"];

async function testSubscriptions() {
  const bot = new Telegraf(BOT_TOKEN);
  
  console.log("=== ТЕСТ ПРОВЕРКИ ПОДПИСОК ===");
  console.log(`Тестируемый пользователь: ${TEST_USER_ID}`);
  console.log(`Проверяемые каналы: ${REQUIRED_CHANNELS.join(", ")}`);
  console.log("");

  for (const channel of REQUIRED_CHANNELS) {
    try {
      console.log(`Проверяю канал: ${channel}`);
      const member = await bot.telegram.getChatMember(channel, TEST_USER_ID);
      console.log(`  Статус: ${member.status}`);
      console.log(`  Подписан: ${["creator", "administrator", "member"].includes(member.status) ? "ДА" : "НЕТ"}`);
    } catch (e) {
      console.log(`  ОШИБКА: ${e.description || e.message}`);
      
      if (e.description?.includes("user not found")) {
        console.log(`  Пользователь не является участником канала ${channel}`);
      } else if (e.description?.includes("chat not found")) {
        console.log(`  Канал ${channel} не найден или бот не добавлен в него`);
      } else if (e.description?.includes("not enough rights")) {
        console.log(`  Бот не имеет прав для проверки участников в канале ${channel}`);
      }
    }
    console.log("");
  }
  
  console.log("=== ТЕСТ ЗАВЕРШЁН ===");
  process.exit(0);
}

testSubscriptions().catch(console.error);
