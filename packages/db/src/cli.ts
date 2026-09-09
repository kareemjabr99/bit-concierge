import postgres from 'postgres';
import { down, status, up } from './migrate.ts';

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error('DATABASE_URL_MIGRATOR is not set. Migrations run as the schema owner.');
  process.exit(1);
}

const command = process.argv[2] ?? 'status';
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  switch (command) {
    case 'up': {
      const applied = await up(sql, {
        onApply: (m) => console.log(`  applied  ${m.version}_${m.name}`),
      });
      console.log(
        applied.length ? `${applied.length} migration(s) applied.` : 'Already up to date.',
      );
      break;
    }
    case 'down': {
      const steps = Number(process.argv[3] ?? 1);
      const reverted = await down(sql, steps, {
        onRevert: (m) => console.log(`  reverted ${m.version}_${m.name}`),
      });
      console.log(`${reverted.length} migration(s) reverted.`);
      break;
    }
    case 'reset': {
      const all = await status(sql);
      await down(sql, all.filter((s) => s.applied).length, {
        onRevert: (m) => console.log(`  reverted ${m.version}_${m.name}`),
      });
      console.log('Reset complete.');
      break;
    }
    case 'status': {
      for (const row of await status(sql)) {
        console.log(`  ${row.applied ? '[x]' : '[ ]'} ${row.version}_${row.name}`);
      }
      break;
    }
    default:
      console.error(`Unknown command "${command}". Use: up | down [n] | reset | status`);
      process.exit(1);
  }
} finally {
  await sql.end();
}
