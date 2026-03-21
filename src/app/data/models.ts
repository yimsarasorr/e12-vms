export interface ScheduleItem {
    days: string[];
    open_time: string;
    close_time: string;
    cron: { open: string; close: string; };
}

export interface ParkingSlotDB {
    slotId: string;
    startTime: string;
    endTime: string;
    displayText: string;
    isAvailable: boolean;
    totalCapacity: number;
    bookedCount: number;
    remainingCount: number;
    timeText: string;
}

export interface ParkingLot {
    id: string;
    name: string;
    category?: 'parking' | 'building'; // New field for location type
    zone?: 'north' | 'south'; // Optional zone for buildings
    capacity: {
        normal: number;
        ev: number;
        motorcycle: number;
    };
    available: {
        normal: number;
        ev: number;
        motorcycle: number;
    };
    floors?: { id: string; name: string }[] | string[];
    mapX: number;
    mapY: number;
    //  พิกัดสำหรับ Map (Latitude, Longitude)
    lat?: number;
    lng?: number;

    status: 'available' | 'full' | 'closed' | 'low';
    isBookmarked: boolean;
    distance: number;
    distanceColor?: string; // Color based on distance
    hours: string;
    hasEVCharger: boolean;
    userTypes: string;
    price: number;
    priceUnit: string;
    supportedTypes: string[];
    schedule?: ScheduleItem[];
    images?: string[];
    note?: string; // e.g. "รองรับผู้มาติดต่อมหาลัย"
    promotion?: string; // e.g. "จอดฟรี 1 ชม."
    description?: string; // Additional details
}

export interface Booking {
    id: string;
    placeName: string;
    locationDetails: string; // e.g. "ชั้น 1 | โซน B | B04"
    bookingTime: Date;
    endTime: Date;
    status: 'pending' | 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'active' | 'checked_in' | 'checked_out' | 'checked_in_pending_payment'; // Added 'active' and 'check' states for parking
    statusLabel?: string; // Optional override for status text
    price: number;
    discountBadge?: string; // e.g. "ลด 15%"
    carBrand: string;     // ยี่ห้อรถ
    licensePlate: string; // ทะเบียนรถ
    bookingType: 'hourly' | 'monthly_regular' | 'flat_24h' | 'daily' | 'monthly' | 'flat24'; // Updated types (legacy included if needed)
    periodLabel?: string; // For special textual times like "เหมาจ่าย 24 ชั่วโมง" or "1 ธ.ค. - 31 ธ.ค."
    timeDetailLabel?: string; // For explicit time range text if needed

    // Detailed Location Fields for easier UI binding
    building?: string;
    floor?: string;
    zone?: string;
    slot?: string;
    vehicleType?: string;
    carId?: string;
    dateLabel?: string;
    reservedAt?: Date;
    // Coordinates for Navigation
    lat?: number;
    lng?: number;
}

export type UserRole = 'User' | 'Host' | 'Visitor' | 'Admin';

export interface UserProfile {
    id?: string;
    name: string;
    phone: string;
    avatar: string;
    role: UserRole;
    role_level?: number; // 0=Guest, 1=Visitor, 2=User, 3=Host
    lineId?: string;
    email?: string;
}

export interface Vehicle {
    id: number | string;
    model: string;
    licensePlate: string;
    province: string;
    image: string;
    isDefault: boolean;
    status: string;
    lastUpdate: string;
    color?: string; // Added color field
    type?: string;  // Added type field
}

export interface SettingItem {
    title: string;
    icon: string;
    value?: string;
}

export interface BuildingData {
    buildingId: string;
    buildingName?: string;
    floors: any[];
    role_prices?: { [key: string]: number };
}

export interface Asset {
    id: string;
    name: string;
    type: string;
    floor_number: number;
}

export interface RolePermission {
    role: UserRole;
}
