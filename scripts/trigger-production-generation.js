const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  throw new Error("CRON_SECRET is not available.");
}

async function main() {
  const response = await fetch("https://leadfindersitora.nl/api/cron/generation", {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Generation watchdog failed (${response.status}): ${body}`);
  }
  console.log(body);
}

main();
