const router = require('express').Router();

router.get('/', (req, res) => {
    res.json({ message: 'Task management API is running.', data: null });
});

module.exports = router;
