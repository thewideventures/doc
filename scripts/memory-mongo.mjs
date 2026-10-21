// DEV/TEST ONLY: starts a throwaway in-memory MongoDB (mongodb-memory-server)
// and prints its URI. Data is discarded when this process exits.
// Usage: npm run dev:memory-db   (then start the server with MONGODB_URI=<printed uri>)
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = Number(process.env.MEMORY_MONGO_PORT || 27999);
const mongod = await MongoMemoryServer.create({ instance: { port, dbName: 'findadoc_test' } });
console.log(`MEMORY_MONGO_URI=${mongod.getUri('findadoc_test')}`);
const stop = async () => { await mongod.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
