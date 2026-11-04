// One scoped preparation per completed episode, independent of Home being mounted.
export function createPlaybackCompletionPreparation() {
  let prepare = null;
  const jobs = new Map();
  return {
    register(handler) {
      prepare = handler;
    },
    prepare(context, scope) {
      if (
        !prepare ||
        !context?.itemId ||
        !Number.isFinite(Number(context.episode)) ||
        Number(context.episode) <= 0
      )
        return Promise.resolve(false);
      const key = JSON.stringify([scope, context.itemId, context.season, context.episode]);
      const prior = jobs.get(key);
      if (prior && Date.now() - prior.at < 60000) return prior.promise;
      const job = { at: Date.now() };
      job.promise = Promise.resolve()
        .then(() => prepare(context, scope))
        .catch(() => false)
        .then((result) => {
          if (!result && jobs.get(key) === job) jobs.delete(key);
          return result;
        });
      jobs.set(key, job);
      while (jobs.size > 8) jobs.delete(jobs.keys().next().value);
      return job.promise;
    }
  };
}
export const playbackCompletionPreparation = createPlaybackCompletionPreparation();
