CREATE TABLE blog_post (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    author VARCHAR(100)
);

INSERT INTO blog_post (title, content, author) VALUES
('Welcome to our blog', 'This is the first post.', 'admin'),
('Vulnerability?', 'There is no vulnerability.', 'developer'),
('Test?', 'Test123123123.', 'developer'),
('Title is here', 'Content is here', 'developer'),
('Flag Post', 'The flag is HZU18{0RM_1nj3ct10n_1s_4_f1lt3r3d_m4l1c10us_c0d3}', 'admin');
