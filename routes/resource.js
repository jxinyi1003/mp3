const express = require('express');
const { ApiError } = require('../utils/errors');
const { isId } = require('../utils/validation');
const { selection, listOptions } = require('../utils/query');

module.exports = function resourceRouter(Model, save, remove, defaultLimit = 0) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const options = listOptions(req.query, defaultLimit);
        // Count all matches, independently of projection and pagination.
        const data = options.count
            ? await Model.countDocuments(options.where)
            : await Model.find(options.where).sort(options.sort).select(options.select)
                .skip(options.skip).limit(options.limit).lean();
        res.status(200).json({ message: 'OK', data });
    });

    router.post('/', async (req, res) => {
        const data = await save(req.body);
        res.status(201).json({ message: `${Model.modelName} created.`, data });
    });

    router.get('/:id', async (req, res) => {
        if (!isId(req.params.id)) throw new ApiError(404, `${Model.modelName} not found.`);
        // Other query parameters do not apply to individual resources.
        const data = await Model.findById(req.params.id).select(selection(req.query)).lean();
        if (!data) throw new ApiError(404, `${Model.modelName} not found.`);
        res.status(200).json({ message: 'OK', data });
    });

    router.put('/:id', async (req, res) => {
        const data = await save(req.body, req.params.id);
        res.status(200).json({ message: `${Model.modelName} updated.`, data });
    });

    router.delete('/:id', async (req, res) => {
        const data = await remove(req.params.id);
        res.status(200).json({ message: `${Model.modelName} deleted.`, data });
    });

    return router;
};
