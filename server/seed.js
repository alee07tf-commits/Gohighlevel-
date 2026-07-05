// CLI entrypoint: `npm run seed`
const { seedDemo } = require('./demo-seed');
seedDemo()
  .then((seeded) => {
    console.log(
      seeded
        ? 'Seeded demo agency. Login: demo@upcro.app / demo123'
        : 'Demo data already seeded. Login: demo@upcro.app / demo123'
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
