require("dotenv").config();

const { Telegraf } = require("telegraf");
const puppeteer = require("puppeteer");

const bot = new Telegraf(process.env.BOT_TOKEN);
// 1. GLOBAL ERROR HANDLER: Prevents the bot from crashing
bot.catch((err, ctx) => {
  console.error(`[Bot Error]`, err);
});

bot.start((ctx) =>
  ctx.reply("Welcome to WebSnap Bot! Send me a link to get a screenshot."),
);

bot.on("text", async (ctx) => {
  const url = ctx.message.text.trim();

  // Basic validation
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return ctx.reply(
      "Please send a valid URL starting with http:// or https://",
    );
  }

  const statusMsg = await ctx.reply("📸 Taking a screenshot, please wait...");

  // 2. DETACHED BACKGROUND TASK: Notice there is no "await" before this function.
  // This allows Telegraf to finish the network request while Puppeteer works in the background.
  (async () => {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // Load the page
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // Pause for animations/fonts to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Capture screenshot
      const screenshotBuffer = await page.screenshot({ fullPage: true });

      // Send to Telegram
      await ctx.replyWithPhoto({ source: screenshotBuffer });

      // Delete the loading message
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    } catch (error) {
      console.error(error);
      await ctx
        .reply(
          "❌ Sorry, the site took too long to capture or the file was too large.",
        )
        .catch(() => {});
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  })();
});

bot.launch();
console.log("WebSnap Bot is now running...");
