import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paceEvents } from './pacing.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rawPath = resolve(process.argv[2] || `${root}/src/data/raw/statsbomb-3869685.json`);
const outputPath = `${root}/src/data/football-demo.json`;
const input = JSON.parse(await readFile(rawPath, 'utf8'));
const teamNames = ['Argentina', 'France'];
const teamCode = name => name === 'Argentina' ? 'ARG' : name === 'France' ? 'FRA' : name.slice(0, 3).toUpperCase();
const selected = [];
let homeGoals = 0;
let awayGoals = 0;
const getClock = event => Number(event.minute || 0) * 60 + Number(event.second || 0);

for (const event of input) {
  const eventType = event.type?.name;
  const team = event.team?.name || 'Unknown';
  const player = event.player?.name || event.substitution?.replacement?.name || team;
  const time = getClock(event);
  let type;
  let importance;
  let text;
  let card;

  if (eventType === 'Shot' && event.shot?.outcome?.name === 'Goal') {
    if (team === 'Argentina') homeGoals += 1;
    else if (team === 'France') awayGoals += 1;
    if (event.shot?.type?.name === 'Penalty') {
      type = 'penalty'; importance = 3; text = `PENALTY GOAL · ${player} (${team}) ${event.minute}'`;
    } else {
      type = 'goal'; importance = 3; text = `GOAL · ${player} (${team}) ${event.minute}'`;
    }
  } else if (eventType === 'Shot' && event.shot?.outcome?.name === 'Saved') {
    type = 'shot_saved'; importance = 2; text = `SHOT SAVED · ${player} (${team}) ${event.minute}'`;
  } else if (eventType === 'Foul Committed' && event.foul_committed?.card?.name) {
    type = 'card'; importance = 2; card = event.foul_committed.card.name.toUpperCase(); text = `${card} · ${player} (${team}) ${event.minute}'`;
  } else if (eventType === 'Substitution') {
    type = 'substitution'; importance = 2;
    text = `SUB · ${event.player?.name || 'Player'} → ${event.substitution?.replacement?.name || 'Player'} (${team}) ${event.minute}'`;
  } else if (eventType === 'VAR' || eventType === 'Video Assistant Referee') {
    type = 'var'; importance = 3; text = `VAR · ${event.var?.decision || event.var?.review_reason || 'REVIEW'} · ${team} ${event.minute}'`;
  } else if (eventType === 'Shot' && event.shot?.type?.name === 'Penalty') {
    type = 'penalty'; importance = 3; text = `PENALTY · ${player} (${team}) ${event.minute}'`;
  } else {
    continue;
  }

  const id = String(event.id);
  const score = { runs: homeGoals, wkts: awayGoals, overs: String(event.minute || 0), display: { label: `${teamCode(teamNames[0])} V ${teamCode(teamNames[1])}`, value: `${homeGoals}–${awayGoals}`, context: `${event.minute || 0}'` } };
  const item = {
    id,
    t: time,
    sport: 'football',
    type,
    importance,
    score,
    players: [event.player?.name, event.substitution?.replacement?.name, team].filter(Boolean),
    text: { en: text, hi: `⟦हिंदी · प्रूफ़रीड⟧ ${text}` },
    bytes: 0,
  };
  selected.push(item);
}

const pacedEvents = paceEvents(selected);
for (const event of pacedEvents) {
  for (let tries = 0; tries < 8; tries += 1) {
    const size = JSON.stringify(event).length;
    if (size === event.bytes) break;
    event.bytes = size;
  }
}
const demo = {
  source: { provider: 'StatsBomb Open Data', id: '3869685', attribution: 'StatsBomb Open Data; StatsBomb logo included per logo-use guidance.' },
  match: { teams: teamNames, date: '2022-12-18', venue: 'Lusail Stadium', event: 'FIFA World Cup Final', outcome: { result: 'Argentina 3–3 France (Argentina won on penalties)' } },
  events: pacedEvents,
};
await writeFile(outputPath, `${JSON.stringify(demo, null, 2)}\n`);
console.log(`Normalized ${pacedEvents.length} StatsBomb events to a paced 360s replay timeline. Wrote ${outputPath}`);
