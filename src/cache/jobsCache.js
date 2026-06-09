import {connectToDb} from '../db/connection.js';

const jobsMap = new Map();

let isReady = false;
let loadedAt = null;
let cacheVersion = 0;

export async function initJobsCache(){
    console.log('[jobsCache] Loading jobs into RAM...');
    const startTime = Date.now();

    const db = await connectToDb();
    const cursor = db.collection('jobs').find({ Status: 'active' });

    jobsMap.clear();

    let loadedCount = 0;
    for await(const job of cursor){
        jobsMap.set(job.JobID, job);
        loadedCount++;
    }

    isReady = true;
    loadedAt = new Date();
    cacheVersion++;

    const elapsedMs = Date.now() - startTime;
    console.log(`[jobsCache] ✅ Loaded ${loadedCount} jobs in ${elapsedMs}ms`);
}

export function getAllJobs(){
    if(!isReady) throw new Error('[jobsCache] cache is not initialized yet');
    return Array.from(jobsMap.values());
}

export function getJobById(jobId){
    if(!isReady) throw new Error('[jobsCache] cache is not initialized yet');
    return jobsMap.get(jobId) || null;
}

export function upsertJob(job){
    if(!job?.JobID) return;
    if(job.Status === 'active'){
        jobsMap.set(job.JobID, job);
    } else {
        jobsMap.delete(job.JobID);
    }
    cacheVersion++;
}

export function removeJob(jobId){
    jobsMap.delete(jobId);
    cacheVersion++;
}

export async function refreshJobsCache(){
    await initJobsCache();
}

export function getCacheStats(){
    return {
        isReady,
        size: jobsMap.size,
        loadedAt,
        cacheVersion,
    };
}