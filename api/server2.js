require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
}

// 修改：检查和转换数据类型的函数
async function validateAndConvertTypes(collection, query) {
  const sampleDocument = await collection.findOne();
  if (!sampleDocument) return query;

  const convertedQuery = { ...query };

  for (const [key, value] of Object.entries(query)) {
    if (key in sampleDocument) {
      const sampleType = typeof sampleDocument[key];
      if (typeof value !== sampleType) {
        if (sampleType === 'number') {
          if (typeof value === 'object' && value !== null) {
            // 处理范围查询
            convertedQuery[key] = Object.fromEntries(
              Object.entries(value).map(([op, val]) => [op, Number(val)])
            );
          } else {
            convertedQuery[key] = Number(value);
          }
        } else if (sampleType === 'string' && key !== 'country') {
          convertedQuery[key] = String(value);
        }
      }
    }
  }

  return convertedQuery;
}

app.get('/api/plans', async (req, res) => {
  console.log('Received query:', req.query);
  try {
    const db = client.db('esimplan1');
    const collection = db.collection('forjapan1');

    const { country, minGB, maxGB, minDays, maxDays, hasVoiceSMS, sortBy, page, limit } = req.query;

    let query = {
      country: new RegExp(`^${country}$`, 'i'),
      size: { $gte: parseFloat(minGB), $lte: parseFloat(maxGB) },
      validity: { $gte: parseInt(minDays) }
    };
    if (maxDays && maxDays !== '0') query.validity.$lte = parseInt(maxDays);
    if (hasVoiceSMS === 'true') query.hasVoiceSMS = true;

    // 验证和转换查询参数的类型
    query = await validateAndConvertTypes(collection, query);

    console.log('MongoDB query:', JSON.stringify(query, null, 2));

    const sort = {};
    switch (sortBy) {
      case 'most-data': sort.size = -1; break;
      case 'cheapest': sort.price = 1; break;
      case 'least-data': sort.size = 1; break;
      case 'lowest-price-gb': sort.pricePerGB = 1; break;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const plans = await collection.find(query).sort(sort).skip(skip).limit(parseInt(limit)).toArray();
    const totalCount = await collection.countDocuments(query);

    console.log('Found plans:', plans.length);
    console.log('Total count:', totalCount);

    res.json({ plans, totalCount });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});

process.on('SIGINT', async () => {
  await client.close();
  console.log('MongoDB connection closed');
  process.exit(0);
});