require('dotenv').config();
const { initializeDatabase } = require('../config/db');

async function run() {
  console.log('🔄 Running manual database seed script...');
  await initializeDatabase();
  console.log('🎉 Seeding completed successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
