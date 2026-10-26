-- Three tables with links, a required column and an allowed-values check.
CREATE TABLE clients (
  id INT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  industry VARCHAR(60),
  website VARCHAR(200),
  status VARCHAR(20) CHECK (status IN ('Prospect', 'Active', 'Dormant'))
);
CREATE TABLE jobs (
  id INT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  client_id INT NOT NULL REFERENCES clients(id),
  openings INT,
  budget DECIMAL(12,2),
  description TEXT,
  posted_on DATE
);
CREATE TABLE applicants (
  id INT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(200),
  phone VARCHAR(30),
  job_id INT,
  is_active BOOLEAN,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
INSERT INTO clients (id, name, industry) VALUES (1, 'Acme Foods', 'FMCG'), (2, 'Northwind', 'Retail');
