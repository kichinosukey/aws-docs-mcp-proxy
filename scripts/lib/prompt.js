import readline from "node:readline";

export function isInteractive() {
  return Boolean(process.stdin.isTTY);
}

export async function confirmOverwrite(message, { assumeYes = false } = {}) {
  if (assumeYes) {
    return true;
  }

  if (!isInteractive()) {
    console.error(
      `${message} [skipped: non-interactive install; cannot prompt]\n` +
      "Re-run with --yes to overwrite existing aws_docs:\n" +
      "  curl -fsSL https://github.com/kichinosukey/aws-docs-mcp-proxy/releases/latest/download/install.sh | bash -s -- --yes"
    );
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
