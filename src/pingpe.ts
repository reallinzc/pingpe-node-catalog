import puppeteer from "@cloudflare/puppeteer";

interface PingPeTaskResponse {
  state?: {
    outstandingNodes?: unknown;
  };
}

export async function fetchPingPePingers(
  browserBinding: Fetcher,
  target: string,
): Promise<unknown> {
  const browser = await puppeteer.launch(browserBinding, { keep_alive: 120_000 });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 pingpe-node-sync/1.0",
    );
    await page.goto(`https://ping.pe/${encodeURIComponent(target)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // The first response is Ping.pe's JavaScript browser check. The page sets
    // its cookie, redirects, renders the pinger rows, and starts the task.
    await page.waitForSelector(".ping-result-row", { timeout: 35_000 });
    await page.waitForFunction(
      () => {
        const scope = globalThis as typeof globalThis & { stream_id_mtr?: string };
        return typeof scope.stream_id_mtr === "string" && scope.stream_id_mtr.length > 0;
      },
      { timeout: 20_000 },
    );

    const payload = await page.evaluate(async () => {
      const scope = globalThis as typeof globalThis & { stream_id_mtr?: string };
      const streamId = scope.stream_id_mtr;
      if (!streamId) {
        throw new Error("Ping.pe did not expose the MTR stream ID");
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await fetch(
          `/ajax_getPingResults_v2.php?stream_id=${encodeURIComponent(streamId)}`,
          { credentials: "same-origin" },
        );
        if (!response.ok) {
          throw new Error(`Ping.pe task endpoint returned ${response.status}`);
        }
        const parsed = JSON.parse(await response.text()) as PingPeTaskResponse;
        const outstanding = parsed.state?.outstandingNodes;
        if (
          outstanding &&
          typeof outstanding === "object" &&
          !Array.isArray(outstanding) &&
          Object.keys(outstanding).length >= 100
        ) {
          return parsed;
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      throw new Error("Ping.pe task did not return a complete pinger map");
    });

    const task = payload as PingPeTaskResponse;
    if (!task.state?.outstandingNodes) {
      throw new Error("Ping.pe response is missing outstandingNodes");
    }
    return task.state.outstandingNodes;
  } finally {
    await browser.close();
  }
}
