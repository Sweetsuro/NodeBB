import nconf from 'nconf';
import _ from 'lodash';

import { Request, Response, NextFunction } from 'express';

import db from '../../database';
import user from '../../user';
import posts from '../../posts';
import categories from '../../categories';
import plugins from '../../plugins';
import meta from '../../meta';
import privileges from '../../privileges';
import accountHelpers from './helpers';
import helpers from '../helpers';
import utils from '../../utils';

import { UserObjectFull, PostObject, Breadcrumbs, GroupFullObject } from '../../types';

type ModUserObject = UserObjectFull & {
    posts: PostObject[],
    latestPosts: PostObject[],
    bestPosts: PostObject[],
    breadcrumbs: Breadcrumbs,
    title: string,
    allowCoverPicture: boolean,
    emailChanged: string,
    selectedGroup: GroupFullObject[],
}

type SessionType = {
    emailChanged: string,
    uids_viewed: { [key: number]: number }
}

type Locals = {
    metaTags: { [key: string]: string | boolean }[],
    isAPI: boolean
}

type PluginDataType = {
    pids: number[]
}

export async function getPosts(callerUid: number, userData: ModUserObject, setSuffix: string): Promise<PostObject[]> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const cids: number[] = await categories.getCidsByPrivilege('categories:cid', callerUid, 'topics:read') as number[];
    const keys: string[] = cids.map(c => `cid:${c}:uid:${userData.uid}:${setSuffix}`);
    let hasMorePosts = true;
    let start = 0;
    const count = 10;
    const postData: PostObject[] = [];

    const [isAdmin, isModOfCids, canSchedule] = await Promise.all([
        user.isAdministrator(callerUid) as Promise<boolean>,
        user.isModerator(callerUid, cids) as Promise<boolean[]>,
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        privileges.categories.isUserAllowedTo('topics:schedule', cids, callerUid) as Promise<boolean[]>,
    ]);
    const cidToIsMod = _.zipObject(cids, isModOfCids);
    const cidToCanSchedule = _.zipObject(cids, canSchedule);

    do {
        /* eslint-disable no-await-in-loop */
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        let pids: number[] = await db.getSortedSetRevRange(keys, start, start + count - 1) as number[];
        if (!pids.length || pids.length < count) {
            hasMorePosts = false;
        }
        if (pids.length) {
            const pluginData = await plugins.hooks.fire('filter:account.profile.getPids', {
                uid: callerUid,
                userData,
                setSuffix,
                pids,
            }) as PluginDataType;
            pids = pluginData.pids;
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const p = await posts.getPostSummaryByPids(pids, callerUid, { stripTags: false }) as PostObject[];
            postData.push(...p.filter(
                p => p && p.topic && (isAdmin || cidToIsMod[p.topic.cid] ||
                    (p.topic.scheduled && cidToCanSchedule[p.topic.cid]) || (!p.deleted && !p.topic.deleted))
            ));
        }
        start += count;
    } while (postData.length < count && hasMorePosts);
    return postData.slice(0, count);
}

export async function getLatestPosts(callerUid: number, userData: ModUserObject): Promise<PostObject[]> {
    return await getPosts(callerUid, userData, 'pids');
}

export async function getBestPosts(callerUid: number, userData: ModUserObject): Promise<PostObject[]> {
    return await getPosts(callerUid, userData, 'pids:votes');
}

function addMetaTags(res: Response<object, Locals>, userData: ModUserObject): void {
    const plainAboutMe = userData.aboutme ? utils.stripHTMLTags(utils.decodeHTMLEntities(userData.aboutme)) : '';
    res.locals.metaTags = [
        {
            name: 'title',
            content: userData.fullname || userData.username,
            noEscape: true,
        },
        {
            name: 'description',
            content: plainAboutMe,
        },
        {
            property: 'og:title',
            content: userData.fullname || userData.username,
            noEscape: true,
        },
        {
            property: 'og:description',
            content: plainAboutMe,
        },
    ];

    if (userData.picture) {
        res.locals.metaTags.push(
            {
                property: 'og:image',
                content: userData.picture,
                noEscape: true,
            },
            {
                property: 'og:image:url',
                content: userData.picture,
                noEscape: true,
            }
        );
    }
}

export async function incrementProfileViews(req: Request & { uid: number } & { session: SessionType },
    userData: ModUserObject): Promise<void> {
    if (req.uid >= 1) {
        req.session.uids_viewed = req.session.uids_viewed || {};

        if (
            req.uid !== userData.uid &&
            (!req.session.uids_viewed[userData.uid] || req.session.uids_viewed[userData.uid] < Date.now() - 3600000)
        ) {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            await user.incrementUserFieldBy(userData.uid, 'profileviews', 1);
            req.session.uids_viewed[userData.uid] = Date.now();
        }
    }
}

export async function get(req: Request & { uid: number } & { session: SessionType },
    res: Response<object, Locals>, next: NextFunction): Promise<void> {
    const lowercaseSlug: string = req.params.userslug.toLowerCase();

    if (req.params.userslug !== lowercaseSlug) {
        if (res.locals.isAPI) {
            req.params.userslug = lowercaseSlug;
        } else {
            const template_val = nconf.get('relative_path') as string;
            return res.redirect(`${template_val}/user/${lowercaseSlug}`);
        }
    }

    const userData: ModUserObject =
    await accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, req.query) as ModUserObject;
    if (!userData) {
        return next();
    }

    await incrementProfileViews(req, userData);

    const [latestPosts, bestPosts] = await Promise.all([
        getLatestPosts(req.uid, userData),
        getBestPosts(req.uid, userData),
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        posts.parseSignature(userData, req.uid),
    ]);

    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    if (meta.config['reputation:disabled']) {
        delete userData.reputation;
    }

    userData.posts = latestPosts; // for backwards compat.
    userData.latestPosts = latestPosts;
    userData.bestPosts = bestPosts;
    userData.breadcrumbs = helpers.buildBreadcrumbs([{ text: userData.username }]);
    userData.title = userData.username;
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    userData.allowCoverPicture = !userData.isSelf || !!meta.config['reputation:disabled'] || userData.reputation >= meta.config['min:rep:cover-picture'];

    // Show email changed modal on first access after said change
    userData.emailChanged = req.session.emailChanged;
    delete req.session.emailChanged;

    if (!userData.profileviews) {
        userData.profileviews = 1;
    }

    addMetaTags(res, userData);

    userData.selectedGroup = userData.groups.filter(group => group && userData.groupTitleArray.includes(group.name))
        .sort((a, b) => userData.groupTitleArray.indexOf(a.name) - userData.groupTitleArray.indexOf(b.name));

    res.render('account/profile', userData);
}
