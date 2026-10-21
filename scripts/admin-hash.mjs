// Usage: npm run admin:hash            (prompts, input hidden)
//        echo -n 'pass' | npm run admin:hash --silent
// Prints a bcrypt hash for ADMIN_PASSWORD_HASH. The password itself is never printed or stored.
import bcrypt from 'bcryptjs';
import readline from 'node:readline';

async function readPassword() {
  if (!process.stdin.isTTY) { let s = ''; for await (const c of process.stdin) s += c; return s.replace(/\r?\n$/, ''); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (/Admin password/.test(s)) process.stdout.write(s); };
  const pw = await new Promise(r => rl.question('Admin password (min 12 chars): ', r));
  rl.close(); process.stdout.write('\n');
  return pw;
}
const pw = await readPassword();
if (pw.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
const hash = await bcrypt.hash(pw, 12);
console.log(`\nADMIN_PASSWORD_HASH='${hash}'`);
console.log('\nAdd this line to your .env exactly as shown (keep the single quotes), restart, and then remove ADMIN_PASSWORD.');
