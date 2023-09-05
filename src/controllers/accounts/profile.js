"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = exports.incrementProfileViews = exports.getBestPosts = exports.getLatestPosts = exports.getPosts = void 0;
const nconf_1 = __importDefault(require("nconf"));
const lodash_1 = __importDefault(require("lodash"));
const database_1 = __importDefault(require("../../database"));
const user_1 = __importDefault(require("../../user"));
const posts_1 = __importDefault(require("../../posts"));
const categories_1 = __importDefault(require("../../categories"));
const plugins_1 = __importDefault(require("../../plugins"));
const meta_1 = __importDefault(require("../../meta"));
const privileges_1 = __importDefault(require("../../privileges"));
const helpers_1 = __importDefault(require("./helpers"));
const helpers_2 = __importDefault(require("../helpers"));
const utils_1 = __importDefault(require("../../utils"));
function getPosts(callerUid, userData, setSuffix) {
    return __awaiter(this, void 0, void 0, function* () {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const cids = yield categories_1.default.getCidsByPrivilege('categories:cid', callerUid, 'topics:read');
        const keys = cids.map(c => `cid:${c}:uid:${userData.uid}:${setSuffix}`);
        let hasMorePosts = true;
        let start = 0;
        const count = 10;
        const postData = [];
        const [isAdmin, isModOfCids, canSchedule] = yield Promise.all([
            user_1.default.isAdministrator(callerUid),
            user_1.default.isModerator(callerUid, cids),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            privileges_1.default.categories.isUserAllowedTo('topics:schedule', cids, callerUid),
        ]);
        const cidToIsMod = lodash_1.default.zipObject(cids, isModOfCids);
        const cidToCanSchedule = lodash_1.default.zipObject(cids, canSchedule);
        do {
            /* eslint-disable no-await-in-loop */
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            let pids = yield database_1.default.getSortedSetRevRange(keys, start, start + count - 1);
            if (!pids.length || pids.length < count) {
                hasMorePosts = false;
            }
            if (pids.length) {
                const pluginData = yield plugins_1.default.hooks.fire('filter:account.profile.getPids', {
                    uid: callerUid,
                    userData,
                    setSuffix,
                    pids,
                });
                pids = pluginData.pids;
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                const p = yield posts_1.default.getPostSummaryByPids(pids, callerUid, { stripTags: false });
                postData.push(...p.filter(p => p && p.topic && (isAdmin || cidToIsMod[p.topic.cid] ||
                    (p.topic.scheduled && cidToCanSchedule[p.topic.cid]) || (!p.deleted && !p.topic.deleted))));
            }
            start += count;
        } while (postData.length < count && hasMorePosts);
        return postData.slice(0, count);
    });
}
exports.getPosts = getPosts;
function getLatestPosts(callerUid, userData) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield getPosts(callerUid, userData, 'pids');
    });
}
exports.getLatestPosts = getLatestPosts;
function getBestPosts(callerUid, userData) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield getPosts(callerUid, userData, 'pids:votes');
    });
}
exports.getBestPosts = getBestPosts;
function addMetaTags(res, userData) {
    const plainAboutMe = userData.aboutme ? utils_1.default.stripHTMLTags(utils_1.default.decodeHTMLEntities(userData.aboutme)) : '';
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
        res.locals.metaTags.push({
            property: 'og:image',
            content: userData.picture,
            noEscape: true,
        }, {
            property: 'og:image:url',
            content: userData.picture,
            noEscape: true,
        });
    }
}
function incrementProfileViews(req, userData) {
    return __awaiter(this, void 0, void 0, function* () {
        if (req.uid >= 1) {
            req.session.uids_viewed = req.session.uids_viewed || {};
            if (req.uid !== userData.uid &&
                (!req.session.uids_viewed[userData.uid] || req.session.uids_viewed[userData.uid] < Date.now() - 3600000)) {
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                yield user_1.default.incrementUserFieldBy(userData.uid, 'profileviews', 1);
                req.session.uids_viewed[userData.uid] = Date.now();
            }
        }
    });
}
exports.incrementProfileViews = incrementProfileViews;
function get(req, res, next) {
    return __awaiter(this, void 0, void 0, function* () {
        const lowercaseSlug = req.params.userslug.toLowerCase();
        if (req.params.userslug !== lowercaseSlug) {
            if (res.locals.isAPI) {
                req.params.userslug = lowercaseSlug;
            }
            else {
                const template_val = nconf_1.default.get('relative_path');
                return res.redirect(`${template_val}/user/${lowercaseSlug}`);
            }
        }
        const userData = yield helpers_1.default.getUserDataByUserSlug(req.params.userslug, req.uid, req.query);
        if (!userData) {
            return next();
        }
        yield incrementProfileViews(req, userData);
        const [latestPosts, bestPosts] = yield Promise.all([
            getLatestPosts(req.uid, userData),
            getBestPosts(req.uid, userData),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            posts_1.default.parseSignature(userData, req.uid),
        ]);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        if (meta_1.default.config['reputation:disabled']) {
            delete userData.reputation;
        }
        userData.posts = latestPosts; // for backwards compat.
        userData.latestPosts = latestPosts;
        userData.bestPosts = bestPosts;
        userData.breadcrumbs = helpers_2.default.buildBreadcrumbs([{ text: userData.username }]);
        userData.title = userData.username;
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        userData.allowCoverPicture = !userData.isSelf || !!meta_1.default.config['reputation:disabled'] || userData.reputation >= meta_1.default.config['min:rep:cover-picture'];
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
    });
}
exports.get = get;
