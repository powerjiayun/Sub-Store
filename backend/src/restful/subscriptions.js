import {
    NetworkError,
    InternalServerError,
    ResourceNotFoundError,
} from './errors';
import { deleteByName, findByName, updateByName } from '@/utils/database';
import { SUBS_KEY, COLLECTIONS_KEY } from '@/constants';
import { getFlowHeaders } from '@/utils/flow';
import { success, failed } from './response';
import $ from '@/core/app';

if (!$.read(SUBS_KEY)) $.write({}, SUBS_KEY);

export default function register($app) {
    $app.get('/api/sub/flow/:name', getFlowInfo);

    $app.route('/api/sub/:name')
        .get(getSubscription)
        .patch(updateSubscription)
        .delete(deleteSubscription);

    $app.route('/api/subs').get(getAllSubscriptions).post(createSubscription);
}

// subscriptions API
async function getFlowInfo(req, res) {
    let { name } = req.params;
    name = decodeURIComponent(name);
    const allSubs = $.read(SUBS_KEY);
    const sub = findByName(allSubs, name);
    if (!sub) {
        failed(
            res,
            new ResourceNotFoundError(
                'RESOURCE_NOT_FOUND',
                `Subscription ${name} does not exist!`,
            ),
            404,
        );
        return;
    }
    if (sub.source === 'local') {
        failed(res, new InternalServerError('NO_FLOW_INFO', 'N/A'));
        return;
    }
    try {
        const flowHeaders = await getFlowHeaders(sub.url);
        if (!flowHeaders) {
            failed(res, new InternalServerError('NO_FLOW_INFO', 'N/A'));
            return;
        }

        // unit is KB
        const upload = Number(flowHeaders.match(/upload=(\d+)/)[1]);
        const download = Number(flowHeaders.match(/download=(\d+)/)[1]);
        const total = Number(flowHeaders.match(/total=(\d+)/)[1]);

        // optional expire timestamp
        const match = flowHeaders.match(/expire=(\d+)/);
        const expires = match ? Number(match[1]) : undefined;

        success(res, { expires, total, usage: { upload, download } });
    } catch (err) {
        failed(
            res,
            new NetworkError(
                `URL_NOT_ACCESSIBLE`,
                `The URL for subscription ${name} is inaccessible.`,
            ),
        );
    }
}

function createSubscription(req, res) {
    const sub = req.body;
    $.info(`正在创建订阅： ${sub.name}`);
    const allSubs = $.read(SUBS_KEY);
    if (findByName(allSubs, sub.name)) {
        res.status(500).json({
            status: 'failed',
            message: `订阅${sub.name}已存在！`,
        });
    }
    allSubs.push(sub);
    $.write(allSubs, SUBS_KEY);
    success(res, sub, 201);
}

function getSubscription(req, res) {
    let { name } = req.params;
    name = decodeURIComponent(name);
    const allSubs = $.read(SUBS_KEY);
    const sub = findByName(allSubs, name);
    if (sub) {
        success(res, sub);
    } else {
        res.status(404).json({
            status: 'failed',
            message: `未找到订阅：${name}!`,
        });
    }
}

function updateSubscription(req, res) {
    let { name } = req.params;
    name = decodeURIComponent(name); // the original name
    let sub = req.body;
    const allSubs = $.read(SUBS_KEY);
    const oldSub = findByName(allSubs, name);
    if (oldSub) {
        const newSub = {
            ...oldSub,
            ...sub,
        };
        $.info(`正在更新订阅： ${name}`);
        // allow users to update the subscription name
        if (name !== sub.name) {
            // we need to find out all collections refer to this name
            const allCols = $.read(COLLECTIONS_KEY);
            for (const collection of allCols) {
                const idx = collection.subscriptions.indexOf(name);
                if (idx !== -1) {
                    collection.subscriptions[idx] = sub.name;
                }
            }
        }
        updateByName(allSubs, name, newSub);
        $.write(allSubs, SUBS_KEY);
        success(res, newSub);
    } else {
        res.status(500).json({
            status: 'failed',
            message: `订阅${name}不存在，无法更新！`,
        });
    }
}

function deleteSubscription(req, res) {
    let { name } = req.params;
    name = decodeURIComponent(name);
    $.info(`删除订阅：${name}...`);
    // delete from subscriptions
    let allSubs = $.read(SUBS_KEY);
    deleteByName(allSubs, name);
    $.write(allSubs, SUBS_KEY);
    // delete from collections
    const allCols = $.read(COLLECTIONS_KEY);
    for (const collection of allCols) {
        collection.subscriptions = collection.subscriptions.filter(
            (s) => s !== name,
        );
    }
    $.write(allCols, COLLECTIONS_KEY);
    success(res);
}

function getAllSubscriptions(req, res) {
    const allSubs = $.read(SUBS_KEY);
    success(res, allSubs);
}
