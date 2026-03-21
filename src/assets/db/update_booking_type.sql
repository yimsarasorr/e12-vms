-- Add booking_type enum if not exists (or text column with check constraint)
-- Ideally we use an ENUM type
DO $$ BEGIN
    CREATE TYPE booking_type_enum AS ENUM ('hourly', 'daily', 'flat_24h', 'monthly_regular', 'monthly_night', 'flat24', 'monthly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alter table to add the column
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS booking_type text DEFAULT 'hourly';

-- If you want to use the enum type casting (optional, staying with text is safer for hybrid usage)
-- ALTER TABLE reservations 
-- ALTER COLUMN booking_type TYPE booking_type_enum USING booking_type::booking_type_enum;

-- Update existing records to default if null
UPDATE reservations SET booking_type = 'hourly' WHERE booking_type IS NULL;
