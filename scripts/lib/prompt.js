import readline from "node:readline";

export async function confirmOverwrite(message, { assumeYes = false } = {}) {
  if (assumeYes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
