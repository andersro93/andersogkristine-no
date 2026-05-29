import { exec } from "node:child_process";
import http from "node:http";

const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

const escapeHtml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// Load environment variables from .env
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "❌ FEIL: SPOTIFY_CLIENT_ID og SPOTIFY_CLIENT_SECRET må være satt i din .env-fil.",
  );
  console.log("Vennligst legg dem til i .env, for eksempel:");
  console.log("SPOTIFY_CLIENT_ID=ditt_client_id");
  console.log("SPOTIFY_CLIENT_SECRET=ditt_client_secret");
  process.exit(1);
}

// Scopes required to modify both public/private/collaborative playlists and read user details
const SCOPES =
  "playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative user-read-private";

const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
  client_id: clientId,
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  scope: SCOPES,
}).toString()}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<h1>Kunne ikke autorisere</h1><p>Spotify returnerte en feil: ${escapeHtml(error || "")}</p>`,
      );
      console.error(`❌ Spotify autorisasjonsfeil: ${error}`);
      cleanupAndExit(1);
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Ugyldig forespørsel</h1><p>Autorisasjonskode mangler.</p>");
      cleanupAndExit(1);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Vellykket!</h1><p>Du kan lukke dette vinduet nå. Sjekk terminalen din for Refresh Token.</p>",
    );

    console.log("🔄 Vekselvirker kode med tokens fra Spotify...");

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      );
      const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        throw new Error(`Token exchange failed: ${errorText}`);
      }

      const data = (await tokenRes.json()) as any;
      const refreshToken = data.refresh_token;

      console.log("\n🎉 Suksess! Ditt Spotify Refresh Token er generert:");
      console.log("--------------------------------------------------");
      console.log(`\x1b[32m${refreshToken}\x1b[0m`);
      console.log("--------------------------------------------------");
      console.log("Legg til denne linjen i din `.env`-fil:\n");
      console.log(`SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
      console.log(
        "\n(Dette tokenet utløper ikke og kan brukes til å foreslå sanger automatisk!)",
      );

      cleanupAndExit(0);
    } catch (err: unknown) {
      console.error(
        "❌ Feil under veksling av kode:",
        err instanceof Error ? err.message : err,
      );
      cleanupAndExit(1);
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`\n🔑 Spotify OAuth Server kjører på http://127.0.0.1:${PORT}`);
  console.log("Åpner nettleseren din for å logge inn på Spotify...");
  console.log(`Hvis den ikke åpnes automatisk, klikk på denne lenken:\n`);
  console.log(`\x1b[36m${authUrl}\x1b[0m\n`);

  // Open browser automatically based on platform
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${openCmd} "${authUrl}"`, (err) => {
    if (err) {
      console.log(
        "(Klarte ikke å åpne nettleseren automatisk, vennligst kopier lenken over.)",
      );
    }
  });
});

function cleanupAndExit(code: number) {
  setTimeout(() => {
    server.close(() => {
      process.exit(code);
    });
  }, 1000);
}
