import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rawDir = join(root, 'src/data/raw');
const outputPath = join(root, 'src/data/cricket-demo.json');
const selectedPath = process.argv[2] ? resolve(process.argv[2]) : null;

const files = selectedPath
  ? [selectedPath]
  : (await readdir(rawDir)).filter(name => name.toLowerCase().endsWith('.json')).sort().map(name => join(rawDir, name));

if (files.length !== 1) {
  throw new Error(`Expected exactly one Cricsheet JSON in ${rawDir}; found ${files.length}. Pass a file path as the first argument to select one.`);
}

const sourcePath = files[0];
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (!Array.isArray(source.innings) || !source.info?.teams) {
  throw new Error(`${basename(sourcePath)} does not look like a Cricsheet match JSON (missing info.teams or innings).`);
}

const events = [];
let elapsed = 0;
let deliveryNumber = 0;
const intervalPattern = [1.2, 1.3, 1.4, 1.5, 1.6];
const teamCode = team => team === 'India' ? 'IND' : team === 'South Africa' ? 'SA' : team.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
const unique = values => [...new Set(values.filter(Boolean))];

function makeEvent({ innings, over, delivery, type, importance, score, players, english, hindi, suffix = '' }) {
  const id = `${String(innings).padStart(2, '0')}-${String(over).padStart(2, '0')}-${String(delivery).padStart(2, '0')}-${type}${suffix ? `-${suffix}` : ''}`;
  const event = {
    id,
    t: Number(elapsed.toFixed(2)),
    sport: 'cricket',
    type,
    importance,
    score: { runs: score.runs, wkts: score.wkts, overs: score.overs },
    players: unique(players),
    text: {
      en: `${english} · ${score.runs}/${score.wkts} · ${score.overs}`,
      hi: `⟦हिंदी · प्रूफ़रीड⟧ ${hindi} · ${score.runs}/${score.wkts} · ${score.overs}`,
    },
    bytes: 0,
  };
  // Include the bytes field itself in the serialized-length count.
  for (let tries = 0; tries < 8; tries += 1) {
    const size = JSON.stringify(event).length;
    if (size === event.bytes) break;
    event.bytes = size;
  }
  events.push(event);
}

for (let inningsIndex = 0; inningsIndex < source.innings.length; inningsIndex += 1) {
  const innings = source.innings[inningsIndex];
  const code = teamCode(innings.team);
  let runs = 0;
  let wkts = 0;
  const batterRuns = new Map();
  const emittedBatterMilestones = new Set();
  const emittedTeamMilestones = new Set();

  for (const overData of innings.overs || []) {
    const deliveries = overData.deliveries || [];
    let lastDelivery = null;

    for (let index = 0; index < deliveries.length; index += 1) {
      const delivery = deliveries[index];
      lastDelivery = delivery;
      elapsed += intervalPattern[deliveryNumber % intervalPattern.length];
      deliveryNumber += 1;

      const runData = delivery.runs || {};
      const batterScore = Number(runData.batter || 0);
      const totalRuns = Number(runData.total || 0);
      const wickets = delivery.wickets || [];
      runs += totalRuns;
      wkts += wickets.length;
      const batterTotal = (batterRuns.get(delivery.batter) || 0) + batterScore;
      batterRuns.set(delivery.batter, batterTotal);
      const overBall = delivery.actual_delivery || `${overData.over}.${index + 1}`;
      const score = { runs, wkts, overs: String(overBall) };
      const fielders = wickets.flatMap(wicket => (wicket.fielders || []).map(fielder => fielder.name || fielder));
      const players = unique([delivery.batter, delivery.non_striker, delivery.bowler, ...wickets.map(wicket => wicket.player_out), ...fielders]);
      const wicket = wickets[0];
      const isBoundary = !runData.non_boundary;

      if (wickets.length) {
        const dismissed = wickets.map(item => item.player_out).filter(Boolean).join(', ');
        const dismissal = wickets.map(item => item.kind).filter(Boolean).join(', ');
        makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'wicket', importance: 3, score, players,
          english: `${code} · WICKET · ${dismissed || delivery.batter} · ${dismissal || 'out'}`,
          hindi: `${code} · विकेट · ${dismissed || delivery.batter} आउट · ${dismissal || 'आउट'}` });
      } else if (batterScore === 6 && isBoundary) {
        makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'six', importance: 3, score, players,
          english: `${code} · SIX · ${delivery.batter}`,
          hindi: `${code} · छक्का · ${delivery.batter}` });
      } else if (batterScore === 4 && isBoundary) {
        makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'four', importance: 2, score, players,
          english: `${code} · FOUR · ${delivery.batter}`,
          hindi: `${code} · चौका · ${delivery.batter}` });
      } else {
        const outcome = totalRuns === 0 ? 'DOT' : `+${totalRuns} RUN${totalRuns === 1 ? '' : 'S'}`;
        const outcomeHi = totalRuns === 0 ? 'खाली गेंद' : `${totalRuns} रन`;
        makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'ball', importance: 1, score, players,
          english: `${code} · ${overBall} · ${outcome} · ${delivery.batter}`,
          hindi: `${code} · ${overBall} · ${outcomeHi} · ${delivery.batter}` });
      }

      for (const milestone of [50, 100]) {
        if (batterTotal >= milestone && !emittedBatterMilestones.has(`${delivery.batter}-${milestone}`)) {
          emittedBatterMilestones.add(`${delivery.batter}-${milestone}`);
          makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'milestone', importance: 2, score, players: [delivery.batter], suffix: `batter-${milestone}`,
            english: `${code} · MILESTONE · ${delivery.batter} ${milestone}`,
            hindi: `${code} · उपलब्धि · ${delivery.batter} ${milestone}` });
        }
      }
      for (const milestone of [50, 100, 150, 200]) {
        if (runs >= milestone && !emittedTeamMilestones.has(milestone)) {
          emittedTeamMilestones.add(milestone);
          makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: index + 1, type: 'milestone', importance: 2, score, players: [delivery.batter], suffix: `team-${milestone}`,
            english: `${code} · MILESTONE · ${milestone} UP`,
            hindi: `${code} · उपलब्धि · ${milestone} रन पूरे` });
        }
      }

      if (wickets.length) elapsed += 0.35;
    }

    if (lastDelivery) {
      elapsed += 0.35;
      const finalBall = lastDelivery.actual_delivery || `${overData.over}.${deliveries.length}`;
      const score = { runs, wkts, overs: `${Number(overData.over) + 1}.0` };
      makeEvent({ innings: inningsIndex + 1, over: overData.over + 1, delivery: deliveries.length, type: 'over_end', importance: 2, score,
        players: [lastDelivery.batter, lastDelivery.non_striker, lastDelivery.bowler],
        english: `${code} · OVER END · ${score.overs} · FINAL BALL ${finalBall}`,
        hindi: `${code} · ओवर समाप्त · ${score.overs} · अंतिम गेंद ${finalBall}` });
    }
  }
}

const demo = {
  source: {
    provider: 'Cricsheet',
    id: basename(sourcePath, '.json'),
    dataVersion: source.meta?.data_version || 'unknown',
    attribution: 'Cricsheet (ODC Attribution License)',
  },
  match: {
    teams: source.info.teams,
    date: source.info.dates?.[0] || '',
    venue: source.info.venue || '',
    event: source.info.event?.name || '',
    outcome: source.info.outcome || {},
  },
  events,
};

await writeFile(outputPath, `${JSON.stringify(demo, null, 2)}\n`);
console.log(`Normalized ${deliveryNumber} deliveries into ${events.length} events (${elapsed.toFixed(1)} demo seconds).`);
console.log(`Wrote ${outputPath}`);
