// PM2 process config for the EC2 backend.
//
// NODE_OPTIONS raises the V8 old-space heap to 768MB (default on a 1GB box is
// ~460MB): the scraper OOM'd after the German expansion grew the company list
// to ~1000 boards, whose jobs each config holds in _allJobsQueue during a run.
// 768MB leaves ~256MB for the OS. If it still OOMs at 768, the next step is
// streaming the queue per-batch in scraperEngine, not more heap.
module.exports = {
  apps: [
    {
      name: 'englishjobs-backend',
      script: 'src/server.js',
      env: {
        NODE_OPTIONS: '--max-old-space-size=768',
      },
    },
  ],
};
