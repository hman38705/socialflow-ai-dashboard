import { prisma } from '../lib/prisma';
import { replicaClient } from '../lib/readReplica';
import { PageLimitParams, toSkipTake } from '../utils/pagination';

export class ListingService {
  /**
   * Toggle the visibility of a listing
   * @param listingId ID of the listing
   * @param mentorId ID of the mentor (for authorization)
   * @param isActive Desired state
   * @param orgId Organization scope
   */
  async toggleVisibility(listingId: string, mentorId: string, isActive: boolean, orgId?: string) {
    // Write operation — use primary
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) {
      throw new Error('Listing not found');
    }

    // Ensure only the mentor who owns the listing can toggle it
    if (listing.mentorId !== mentorId) {
      throw new Error('Unauthorized: You can only toggle your own listings');
    }

    return prisma.listing.update({
      where: { id: listingId },
      data: { isActive },
      ...(orgId ? { __orgId: orgId } : {}),
    } as any);
  }

  /**
   * Search listings, excluding hidden ones
   * @param query Search string
   * @param params Page/limit pagination params
   * @param orgId Organization scope
   */
  async searchListings(
    query: string = '',
    params: PageLimitParams,
    orgId?: string,
  ): Promise<{ data: any[]; total: number }> {
    // Read-only operation — use read replica
    const q = query.trim();
    const where = {
      isActive: true,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const baseArgs = { where, ...toSkipTake(params) };
    const orgArgs = orgId ? { ...baseArgs, __orgId: orgId } : baseArgs;

    const [total, data] = await Promise.all([
      replicaClient.listing.count(orgId ? ({ where, __orgId: orgId } as any) : { where }),
      replicaClient.listing.findMany(orgArgs as any),
    ]);

    return { data, total };
  }
}

export const listingService = new ListingService();
