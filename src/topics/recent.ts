import db from '../database';
import plugins from '../plugins';
import posts from '../posts';

import { TopicObject } from '../types';

interface optionType {
    uid: number;
    start: number;
    stop: number;
    term: string;
}

interface TopicsLink {
    topics: TopicObject;
    nextStart: number;
}

interface SortedTopicsLink {
    cids: number,
    uid: number,
    start: number,
    stop: number,
    filter: string,
    sort: string;
}

interface TopicsType {
    getRecentTopics(cid: number, uid: number, start: number, stop: number, filter: string): Promise<TopicsLink>;
    getSortedTopics(dict: SortedTopicsLink): Promise<TopicsLink>;
    getLatestTopics(options: optionType): Promise<TopicsLink>;
    getLatestTidsFromSet(key: string, start: number, stop: number, term: string): Promise<number[]>;
    getTopics(tids: number[], options: optionType): Promise<TopicObject>;
    updateLastPostTimeFromLastPid(tid: number): Promise<void>;
    getLatestUndeletedPid(tid: number): Promise<number>;
    updateLastPostTime(tid: number, lastposttime: string): Promise<void>;
    setTopicField(tid: number, key: string, value: string): Promise<void>;
    getTopicFields(tid: number, arr:string[]): Promise<TopicObject>;
    updateRecent(tid: number, timestamp: string): Promise<void>;
}

export = function (Topics: TopicsType) {
    const terms = {
        day: 86400000,
        week: 604800000,
        month: 2592000000,
        year: 31104000000,
    };

    Topics.getRecentTopics = async function (cid: number, uid: number, start: number, stop: number, filter: string) {
        return await Topics.getSortedTopics({
            cids: cid,
            uid: uid,
            start: start,
            stop: stop,
            filter: filter,
            sort: 'recent',
        });
    };

    /* not an orphan method, used in widget-essentials */
    Topics.getLatestTopics = async function (options: optionType) {
        // uid, start, stop, term
        const tids = await Topics.getLatestTidsFromSet('topics:recent', options.start, options.stop, options.term);
        const topics = await Topics.getTopics(tids, options);
        return { topics: topics, nextStart: options.stop + 1 };
    };

    Topics.getLatestTidsFromSet = async function (set: string, start: number, stop: number, term: string) {
        let since = terms.day;
        if (terms[term]) {
            since = terms[term];
        }

        const count = stop === -1 ? stop : stop - start + 1;
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return await db.getSortedSetRevRangeByScore(set, start, count, '+inf', Date.now() - since);
    };

    Topics.updateLastPostTimeFromLastPid = async function (tid: number) {
        const pid = await Topics.getLatestUndeletedPid(tid);
        if (!pid) {
            return;
        }
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const timestamp = await posts.getPostField(pid, 'timestamp');
        if (!timestamp) {
            return;
        }
        await Topics.updateLastPostTime(tid, timestamp);
    };

    Topics.updateLastPostTime = async function (tid: number, lastposttime: string) {
        await Topics.setTopicField(tid, 'lastposttime', lastposttime);
        const topicData = await Topics.getTopicFields(tid, ['cid', 'deleted', 'pinned']);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetAdd(`cid:${topicData.cid}:tids:lastposttime`, lastposttime, tid);

        await Topics.updateRecent(tid, lastposttime);

        if (!topicData.pinned) {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            await db.sortedSetAdd(`cid:${topicData.cid}:tids`, lastposttime, tid);
        }
    };

    Topics.updateRecent = async function (tid: number, timestamp: string) {
        let data = { tid: tid, timestamp: timestamp };
        if (plugins.hooks.hasListeners('filter:topics.updateRecent')) {
            data = await plugins.hooks.fire('filter:topics.updateRecent', { tid: tid, timestamp: timestamp });
        }
        if (data && data.tid && data.timestamp) {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            await db.sortedSetAdd('topics:recent', data.timestamp, data.tid);
        }
    };
};