import express, { Express } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import healthRoutes from './routes/health.routes';

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.use('/api', healthRoutes);

// Welcome route
app.get('/', (req, res) => {
  res.send('SocialFlow API - Social Media Dashboard Backend');
});

export default app;
