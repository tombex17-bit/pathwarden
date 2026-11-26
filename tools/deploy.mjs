// Publishes the game: `npm run deploy`. Runs every check and browser test first, then pushes
// dist/ to the gh-pages branch, which GitHub Pages serves. Nothing is published if a check fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const stop = (message) => {
  console.error(message);
  process.exit(1);
};
function run(script) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: true });
  if (result.status !== 0) stop(`npm run ${script} failed, so nothing was published.`);
}

// The live game should always match a commit.
if (git(['status', '--porcelain'])) stop('Commit your changes first, so the published game matches a commit.');
const commit = git(['rev-parse', '--short', 'HEAD']);
const remote = git(['remote', 'get-url', 'origin']);

run('check');
run('test:e2e');

// The build is fresh after the browser tests. Vite keeps dist/.git between builds.
writeFileSync('dist/.nojekyll', '');
git(['init', '-q', '-b', 'gh-pages'], 'dist');
git(['add', '-A'], 'dist');
git(['commit', '-q', '--allow-empty', '-m', `Deploy ${commit}`], 'dist');
git(['push', '-q', '-f', remote, 'gh-pages'], 'dist');
console.log(`Published ${commit} to the gh-pages branch. GitHub Pages updates within a few minutes.`);
