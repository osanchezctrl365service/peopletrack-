-- =====================================================================
-- PeopleTrack — Migración Quick Wins (Quick Wins #5 y #6)
-- Fecha: 2026-07-24
-- Autor: Sesión Claude
--
-- OBJETIVO:
--   Agregar columnas nuevas a las tablas Users y Objectives.
--
-- SEGURO PARA CORRER MÚLTIPLES VECES:
--   Cada ALTER TABLE verifica si la columna ya existe antes de crearla.
--   Si algo ya está aplicado, no hace nada. No borra ni modifica data.
--
-- CÓMO CORRERLO:
--   1. Ir al portal Azure → SQL databases → PeopleTrackDB
--   2. Click en "Query editor (preview)" (menú de la izquierda)
--   3. Loguearse con el usuario admin de SQL
--   4. Copiar y pegar TODO este script
--   5. Click en "Run" (▷)
--   6. Verificar que abajo diga "Query succeeded"
-- =====================================================================

-- ---------------------------------------------------------------------
-- Quick Win #5: Usuarios — agregar Nro de legajo + Fecha de ingreso
-- ---------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'EmployeeNumber'
)
BEGIN
    ALTER TABLE [dbo].[Users] ADD EmployeeNumber INT NULL;
    PRINT '✅ Columna Users.EmployeeNumber creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Users.EmployeeNumber ya existía — no se hace nada';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'HireDate'
)
BEGIN
    ALTER TABLE [dbo].[Users] ADD HireDate DATE NULL;
    PRINT '✅ Columna Users.HireDate creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Users.HireDate ya existía — no se hace nada';
END
GO

-- ---------------------------------------------------------------------
-- Quick Win #6: Objetivos — agregar Feedback + Áreas de mejora + fechas
-- ---------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Objectives' AND COLUMN_NAME = 'Feedback'
)
BEGIN
    ALTER TABLE [dbo].[Objectives] ADD Feedback NVARCHAR(MAX) NULL;
    PRINT '✅ Columna Objectives.Feedback creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Objectives.Feedback ya existía';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Objectives' AND COLUMN_NAME = 'FeedbackDate'
)
BEGIN
    ALTER TABLE [dbo].[Objectives] ADD FeedbackDate DATETIME NULL;
    PRINT '✅ Columna Objectives.FeedbackDate creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Objectives.FeedbackDate ya existía';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Objectives' AND COLUMN_NAME = 'ImprovementAreas'
)
BEGIN
    ALTER TABLE [dbo].[Objectives] ADD ImprovementAreas NVARCHAR(MAX) NULL;
    PRINT '✅ Columna Objectives.ImprovementAreas creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Objectives.ImprovementAreas ya existía';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Objectives' AND COLUMN_NAME = 'ImprovementAreasDate'
)
BEGIN
    ALTER TABLE [dbo].[Objectives] ADD ImprovementAreasDate DATETIME NULL;
    PRINT '✅ Columna Objectives.ImprovementAreasDate creada';
END
ELSE
BEGIN
    PRINT 'ℹ️  Columna Objectives.ImprovementAreasDate ya existía';
END
GO

-- ---------------------------------------------------------------------
-- Verificación final: mostrar las columnas nuevas
-- ---------------------------------------------------------------------
PRINT '';
PRINT '========================================';
PRINT 'VERIFICACIÓN — columnas resultantes:';
PRINT '========================================';

SELECT
    TABLE_NAME AS 'Tabla',
    COLUMN_NAME AS 'Columna',
    DATA_TYPE AS 'Tipo',
    IS_NULLABLE AS 'Nullable'
FROM INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'Users' AND COLUMN_NAME IN ('EmployeeNumber', 'HireDate'))
   OR (TABLE_NAME = 'Objectives' AND COLUMN_NAME IN ('Feedback', 'FeedbackDate', 'ImprovementAreas', 'ImprovementAreasDate'))
ORDER BY TABLE_NAME, COLUMN_NAME;

PRINT '';
PRINT '✅ Migración completada.';
PRINT 'Si ves 6 filas arriba (2 de Users + 4 de Objectives), todo OK.';
