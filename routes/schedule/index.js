const express = require('express');
const router = express.Router();

router.use(require('./current'));
router.use(require('./availableYears'));
router.use(require('./setCurrent'));
router.use(require('./resources'));
router.use(require('./saveDistribution'));
router.use(require('./preview'));
router.use(require('./yearplan'));
router.use(require('./queries'));

module.exports = router;