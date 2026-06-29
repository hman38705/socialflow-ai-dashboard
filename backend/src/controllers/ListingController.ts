import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { listingService } from '../services/ListingService';
import { parsePageLimit, buildPageResponse } from '../utils/pagination';

const createListingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const createListing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createListingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten().fieldErrors });
    }

    const mentorId = (req as any).user?.id;
    if (!mentorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const orgId: string | undefined = (req as any).activeOrgId;
    const listing = await listingService.createListing({ ...parsed.data, mentorId }, orgId);
    res.status(201).json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};

export const getListing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId: string | undefined = (req as any).activeOrgId;
    const listing = await listingService.findById(req.params.id, orgId);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};

export const deleteListing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mentorId = (req as any).user?.id;
    if (!mentorId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const orgId: string | undefined = (req as any).activeOrgId;
    await listingService.deleteListing(req.params.id, mentorId, orgId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const listListings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = parsePageLimit(req);
    const orgId: string | undefined = (req as any).activeOrgId;
    const { data, total } = await listingService.list(params, orgId);
    res.json(buildPageResponse(req, data, total, params));
  } catch (err) {
    next(err);
  }
};

export const toggleListingVisibility = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const mentorId = (req as any).user?.id || req.body.mentorId;
    const orgId: string | undefined = (req as any).user?.organizationId;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive is required' });
    }

    if (!mentorId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Missing mentor ID' });
    }

    const updatedListing = await listingService.toggleVisibility(id, mentorId, isActive, orgId);

    res.json({
      success: true,
      message: `Listing visibility toggled. State: ${isActive ? 'Active' : 'Inactive'}`,
      data: updatedListing,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const searchListings = async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || '';
    const params = parsePageLimit(req);
    const orgId: string | undefined = (req as any).user?.organizationId;
    const { data, total } = await listingService.searchListings(query, params, orgId);

    res.json(buildPageResponse(req, data, total, params));
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
