import { initProLibrary, listProVideos, ensureProVideoAvailable } from '../services/proLibrary.js';

async function main() {
  await initProLibrary();
  const pros = await listProVideos();
  for (const item of pros) {
    if (item.available) {
      console.log(`already available: ${item.id}`);
      continue;
    }
    console.log(`downloading: ${item.id}`);
    await ensureProVideoAvailable(item.id);
    console.log(`downloaded: ${item.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
