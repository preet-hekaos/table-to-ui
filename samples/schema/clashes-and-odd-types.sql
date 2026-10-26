-- Names that already exist in the recruitment pack (candidate, client), odd types,
-- an ENUM, a self link, and statements the importer ignores.
SET NAMES utf8;
CREATE TABLE candidate (
  id BIGINT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  level ENUM('Junior','Mid','Senior') NOT NULL,
  resume_blob BLOB,
  location GEOGRAPHY,
  manager_id INT REFERENCES candidate(id)
);
CREATE TABLE client (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  signed_at TIMESTAMP,
  rating DOUBLE
);
CREATE INDEX idx_client_name ON client(name);
CREATE VIEW v_clients AS SELECT * FROM client;
INSERT INTO client (id, name) VALUES (1, 'Acme'), (2, 'Globex'), (3, 'Initech');
