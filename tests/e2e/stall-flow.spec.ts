import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CricketDemo } from '../../src/data/types';

const cricket = JSON.parse(readFileSync(new URL('../../src/data/cricket-demo.json', import.meta.url), 'utf8')) as CricketDemo;

async function startAndSetLongRestore(page: import('@playwright/test').Page) {
  await page.goto('/');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.4);
  await expect(video).toHaveJSProperty('muted', true);
  await page.locator('.director-details > summary').evaluate(summary => (summary as HTMLElement).click());
  await page.locator('.secondary-control').filter({ hasText: '20s' }).evaluate(button => (button as HTMLButtonElement).click());
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    if (!video || video.paused || !video.buffered.length) return false;
    return video.buffered.end(video.buffered.length - 1) - video.currentTime <= 0.2;
  }, undefined, { timeout: 15_000, polling: 50 });
}

async function breakUntilStalled(page: import('@playwright/test').Page, timeout = 4_500) {
  const start = Date.now();
  // Use the in-player action so the test stays on the visible mobile surface.
  await page.getByRole('region', { name: 'KeepAlive match player' }).getByRole('button', { name: 'Break the network' }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.match-experience.experience-stalled')).toBeVisible({ timeout });
  expect(Date.now() - start).toBeLessThanOrEqual(timeout);
}

test('video starts; a real network break feeds events and recap counts match the replay data', async ({ page }) => {
  await startAndSetLongRestore(page);
  await expect(page.locator('.player-state')).toContainText('LIVE');

  const initialFeedCount = await page.locator('.event-counter').evaluate(element => Number(element.textContent?.trim().split(/\s+/)[0]));
  await breakUntilStalled(page, 4_500);
  const stalledVideoTime = await page.locator('video').evaluate(video => video.currentTime);
  await page.waitForTimeout(600);
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeCloseTo(stalledVideoTime, 1);
  const countAtStall = await page.locator('.event-counter').evaluate(element => Number(element.textContent?.trim().split(/\s+/)[0]));
  await expect.poll(async () => page.locator('.event-counter').evaluate(element => Number(element.textContent?.trim().split(/\s+/)[0])), { timeout: 6_000 }).toBeGreaterThan(countAtStall);
  expect(countAtStall).toBeGreaterThanOrEqual(initialFeedCount);

  await page.getByRole('button', { name: 'Restore', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('[data-freeze-state="recovering"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.recap-title')).toBeVisible({ timeout: 7_000 });
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(stalledVideoTime);

  const recap = page.locator('.match-experience.experience-recap');
  const liveClock = Number(await recap.getAttribute('data-recap-live-clock'));
  const videoClock = Number(await recap.getAttribute('data-recap-video-clock'));
  const missed = cricket.events.filter(event => event.t <= liveClock && event.t > videoClock && event.importance >= 2);
  const chips = (await page.locator('.recap-chips span').allTextContents()).map(text => text.trim());
  const wickets = missed.filter(event => event.type === 'wicket').length;
  const sixes = missed.filter(event => event.type === 'six').length;
  const fours = missed.filter(event => event.type === 'four').length;
  const overEnd = missed.find(event => event.type === 'over_end');
  const lastLiveScore = [...cricket.events].reverse().find(event => event.t <= liveClock)?.score;
  const lastVideoScore = [...cricket.events].reverse().find(event => event.t <= videoClock)?.score;
  const sameInnings = cricket.events.find(event => event.t <= liveClock)?.id.slice(0, 3) === cricket.events.find(event => event.t <= videoClock)?.id.slice(0, 3);
  const runs = Math.max(0, (lastLiveScore?.runs || 0) - (sameInnings ? lastVideoScore?.runs || 0 : 0));
  const expected = [
    ...(wickets ? [`${wickets} ${wickets === 1 ? 'wicket' : 'wickets'}`] : []),
    ...(runs ? [`${runs} runs`] : []),
    ...(sixes ? [`${sixes} ${sixes === 1 ? 'six' : 'sixes'}`] : []),
    ...(fours ? [`${fours} ${fours === 1 ? 'four' : 'fours'}`] : []),
    ...(overEnd ? [`Over ${overEnd.score.overs.split('.')[0]} done`] : []),
  ];
  expect(chips).toEqual(expected);
  await page.locator('.recap-timeline summary').click();
  await expect(page.locator('.recap-timeline article')).toHaveCount(missed.length);
});

test('each sport loads its own local match footage', async ({ page }) => {
  await page.goto('/');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.4);
  await expect(page.locator('.player-shell')).toHaveAttribute('data-video-source', '/media/index.m3u8');
  await page.locator('.director-details > summary').evaluate(summary => (summary as HTMLElement).click());

  await page.getByRole('button', { name: 'Football' }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.player-shell')).toHaveAttribute('data-video-source', '/media/football/index.m3u8');
  await expect.poll(() => page.locator('video').evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.4);
  await expect(page.locator('.video-scorebug > span')).toHaveText('ARG V FRA');
  await expect(page.locator('.video-scorebug strong')).toHaveText('0–0');
  await expect(page.locator('.statsbomb-credit')).toBeVisible();

  await page.getByRole('button', { name: 'F1' }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.player-shell')).toHaveAttribute('data-video-source', '/media/f1/index.m3u8');
  await expect.poll(() => page.locator('video').evaluate(element => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.4);
  await expect(page.locator('.video-scorebug')).toContainText(/GRID|P[1-9]/);
  await expect(page.locator('.app-credit')).toContainText('CC BY-SA 4.0');
});

test('a 1.5 second stutter does not open the stall sheet', async ({ page }) => {
  await startAndSetLongRestore(page);
  await page.locator('video').evaluate(async video => {
    video.dispatchEvent(new Event('waiting'));
    await new Promise(resolve => window.setTimeout(resolve, 1_500));
    video.dispatchEvent(new Event('playing'));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('.match-experience')).toHaveCount(0);
  await expect(page.locator('[data-freeze-state="playing"]')).toBeVisible();
});

test('offline while stalled replaces the event feed with the offline card', async ({ page, context }) => {
  await startAndSetLongRestore(page);
  await breakUntilStalled(page, 4_500);
  await context.setOffline(true);
  await expect(page.getByText('You’re offline.')).toBeVisible();
  await expect(page.getByText('The match is still running.')).toBeVisible();
  await context.setOffline(false);
});

test('fullscreen keeps the stall overlay inside the wrapper target', async ({ page }) => {
  await startAndSetLongRestore(page);
  await breakUntilStalled(page, 4_500);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('player-shell') || false)).toBe(true);
  await expect(page.locator('.player-shell .match-experience.experience-stalled')).toBeVisible();
  await page.keyboard.press('Escape');
});
