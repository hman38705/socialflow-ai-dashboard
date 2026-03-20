import dotenv from 'dotenv';
import app from './app';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`
      🚀 Server is running!
      📡 Listening on port ${PORT}
      🏠 Local: http://localhost:${PORT}
      🏥 Health: http://localhost:${PORT}/api/health
    `);
});
