require("../base_de_donnee/initDb.js");
const db = require("../base_de_donnee/db");
const { v4: uuidv4 } = require('uuid');



const saveForm = (id, title, json_data) => {
  return new Promise((resolve, reject) => {
    const components = json_data.components || [];

    db.run("BEGIN TRANSACTION", (err) => {
      if (err) return reject(err);

      db.run(
        "INSERT INTO forms (id, title, json_data) VALUES (?, ?, ?)",
        [id, title, JSON.stringify(json_data)],
        (err) => {
          if (err) {
            db.run("ROLLBACK");
            return reject(err);
          }

          components.forEach((c) => {

            // Récupération dynamique du label selon le type
            const label = c.label || c.dateLabel || "";  

            db.run(

              "INSERT INTO components (id, form_id, label, type, key_name, layout) VALUES (?, ?, ?, ?, ?, ?)",
              [c.id, id, label, c.type, c.key || "", JSON.stringify(c.layout)],
              (err) => {
                if (err) {
                  db.run("ROLLBACK");
                  return reject(err);
                }
              }
            );
          });

          db.run("COMMIT", (err) => {
            if (err) return reject(err);
            resolve("Formulaire et composants enregistrés !");
          });
        }
      );
    });
  });
};

const getAllForms = () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT id, title, created_at, updated_at FROM forms ORDER BY created_at DESC", (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

const getFormById = (id) => {
  return new Promise((resolve, reject) => {
    db.get("SELECT id, json_data, created_at, title FROM forms WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error("Formulaire non trouvé"));

      try {
        const jsonData = JSON.parse(row.json_data);
        if (!jsonData || !jsonData.components) {
          return reject(new Error("Le formulaire ne contient pas de composants valides."));
        }
        resolve({ id: row.id, json_data: jsonData, created_at: row.created_at, title: row.title });
      } catch (e) {
        reject(new Error("Erreur lors du traitement du schéma du formulaire"));
      }
    });
  });
};

const hasResponses = (id) => {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) AS total FROM responses WHERE form_id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(parseInt(row.total) > 0);
    });
  });
};

const updateForm = (id, title, json_data) => {
  return new Promise((resolve, reject) => {
    db.run("BEGIN TRANSACTION", async (err) => {
      if (err) return reject(err);

      // 1. Mettre à jour le formulaire
      db.run(
        "UPDATE forms SET title = ?, json_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [title, JSON.stringify(json_data), id],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return reject(err);
          }

          // 2. Supprimer les composants existants
          db.run("DELETE FROM components WHERE form_id = ?", [id], (err) => {
            if (err) {
              db.run("ROLLBACK");
              return reject(err);
            }

            // 3. Réinsérer les composants à partir de json_data
            const components = json_data.components || [];

            const insertPromises = components.map((c) => {
              return new Promise((res, rej) => {
                db.run(
                  "INSERT INTO components (id, form_id, label, type, key_name, layout) VALUES (?, ?, ?, ?, ?, ?)",
                  [
                    c.id,
                    id,
                    c.label || "",
                    c.type || "text",
                    c.key || "",
                    JSON.stringify(c.layout || {}),
                  ],
                  (err) => {
                    if (err) return rej(err);
                    res();
                  }
                );
              });
            });

            Promise.all(insertPromises)
              .then(() => {
                db.run("COMMIT", (err) => {
                  if (err) {
                    db.run("ROLLBACK");
                    return reject(err);
                  }
                  resolve(1); // 1 = succès
                });
              })
              .catch((err) => {
                db.run("ROLLBACK");
                reject(err);
              });
          });
        }
      );
    });
  });
};


const deleteForm = (id) => {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) AS total FROM responses WHERE form_id = ?", [id], (err, row) => {
      if (err) return reject(err);

      const total = parseInt(row.total);
      if (total > 0) {
        db.run("BEGIN TRANSACTION", (err) => {
          if (err) return reject(err);

          db.run("DELETE FROM responses WHERE form_id = ?", [id], (err) => {
            if (err) return reject(err);

            db.run("DELETE FROM forms WHERE id = ?", [id], (err) => {
              if (err) return reject(err);

              db.run("COMMIT", (err) => {
                if (err) return reject(err);
                resolve("Formulaire et réponses supprimés avec succès !");
              });
            });
          });
        });
      } else {
        db.run("DELETE FROM forms WHERE id = ?", [id], (err) => {
          if (err) return reject(err);
          resolve("Formulaire supprimé avec succès !");
        });
      }
    });
  });
};


// Service function to duplicate a form
const duplicateForm = async (formId) => {
  return new Promise((resolve, reject) => {
    db.run("BEGIN TRANSACTION");

    db.get("SELECT * FROM forms WHERE id = ?", [formId], (err, form) => {
      if (err || !form) {
        db.run("ROLLBACK");
        return reject({ success: false, error: err ? err.message : "Formulaire introuvable" });
      }

      const oldJson = JSON.parse(form.json_data);
      const componentIdMap = {};

      // Générer un nouvel ID pour chaque composant
      const newComponents = oldJson.components.map((comp) => {
        const newId = `Comp_${uuidv4().slice(0, 8)}`;
        componentIdMap[comp.id] = newId;
        return { ...comp, id: newId };
      });

      const newFormJson = {
        ...oldJson,
        components: newComponents
      };

      // Générer un ID de formulaire unique
      const generateUniqueFormId = () => {
        return new Promise((resolve, reject) => {
          const tryGenerate = () => {
            const newId = `Form_${Math.random().toString(36).slice(2, 10)}`;
            db.get("SELECT id FROM forms WHERE id = ?", [newId], (err, row) => {
              if (err) return reject(err);
              if (row) return tryGenerate();
              resolve(newId);
            });
          };
          tryGenerate();
        });
      };

      generateUniqueFormId()
        .then((newFormId) => {
          const newTitle = `${form.title} (copy)`;
          const jsonDataString = JSON.stringify(newFormJson);

          db.run(
            "INSERT INTO forms (id, title, json_data, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [newFormId, newTitle, jsonDataString],
            (err) => {
              if (err) {
                db.run("ROLLBACK");
                return reject({ success: false, error: err.message });
              }

              db.all("SELECT * FROM components WHERE form_id = ?", [formId], (err, components) => {
                if (err) {
                  db.run("ROLLBACK");
                  return reject({ success: false, error: err.message });
                }

                const insertTasks = components.map((comp) => {
                  const newId = componentIdMap[comp.id];
                  return new Promise((res, rej) => {
                    db.run(
                      "INSERT INTO components (id, form_id, label, type, action, key_name, layout) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      [
                        newId,
                        newFormId,
                        comp.label,
                        comp.type,
                        comp.action,
                        comp.key_name,
                        comp.layout
                      ],
                      (err) => {
                        if (err) return rej(err);
                        res();
                      }
                    );
                  });
                });

                Promise.all(insertTasks)
                  .then(() => {
                    db.run("COMMIT", (err) => {
                      if (err) {
                        db.run("ROLLBACK");
                        return reject({ success: false, error: err.message });
                      }
                      resolve({ success: true, newFormId });
                    });
                  })
                  .catch((error) => {
                    db.run("ROLLBACK");
                    reject({ success: false, error: error.message });
                  });
              });
            }
          );
        })
        .catch((error) => {
          db.run("ROLLBACK");
          reject({ success: false, error: error.message });
        });
    });
  });
};


exports.setDefaultUserId = (form_id, default_user_id) => {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO default_user_ids (form_id, default_user_id)
      VALUES (?, ?)
      ON CONFLICT(form_id) DO UPDATE SET default_user_id = excluded.default_user_id
      `,
      [form_id, default_user_id],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
};

exports.getDefaultUserId = (form_id) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT default_user_id FROM default_user_ids WHERE form_id = ?`,
      [form_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.default_user_id : null);
      }
    );
  });
};

module.exports = {
  saveForm,
  getAllForms,
  getFormById,
  hasResponses,
  updateForm,
  deleteForm,
  duplicateForm,
};
