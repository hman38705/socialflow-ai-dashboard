import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.BACKEND_PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 SocialFlow Backend is running on http://localhost:${PORT}`);
});
